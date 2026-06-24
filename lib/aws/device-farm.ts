/**
 * AWS Device Farm — programmatic Appium test runner.
 *
 * Each job:
 *  1. Creates a test run on a real Android device
 *  2. Passes dynamic params (buyer email, barcode, etc.) via extraData env vars
 *  3. Polls until the run completes or times out
 *  4. Returns pass/fail + any output message
 *
 * Required env vars:
 *   AWS_REGION              e.g. "us-west-2"
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_DEVICE_FARM_PROJECT_ARN   — ARN of your Device Farm project
 *   AWS_DEVICE_FARM_DEVICE_POOL_ARN — ARN of the Android device pool
 *   AWS_DEVICE_FARM_APP_ARN       — ARN of the uploaded MLB Ballpark base APK
 *   AWS_DEVICE_FARM_EXTRA_DATA_ARN — ARN of splits-data.zip (EXTERNAL_DATA upload)
 *   MLB_DEPOSITS_EMAIL         e.g. "deposits@buzzerseats.com"
 *   MLB_DEPOSITS_PASSWORD
 */

import {
  DeviceFarmClient,
  CreateUploadCommand,
  GetUploadCommand,
  ScheduleRunCommand,
  GetRunCommand,
  UploadType,
  ExecutionStatus,
  ExecutionResult,
} from "@aws-sdk/client-device-farm";

const client = new DeviceFarmClient({ region: "us-west-2" });

// Hardcoded — these are fixed for the buzzerseats Device Farm project
const PROJECT_ARN = "arn:aws:devicefarm:us-west-2:768309077680:project:df30cdff-cddf-42a7-977d-4997188d3e2d";
const DEVICE_POOL_ARN = "arn:aws:devicefarm:us-west-2::devicepool:082d10e5-d7d7-48a5-ba5c-b33d66efa1f5"; // Top Devices
// Dummy APK satisfies Device Farm's required appArn — our test spec installs the real MLB splits
const DUMMY_APP_ARN = "arn:aws:devicefarm:us-west-2:768309077680:upload:df30cdff-cddf-42a7-977d-4997188d3e2d/7d49e3a4-386b-4a78-a9a5-5de9ae29a2ba";

// How long to wait for a run to finish (15 minutes max)
const RUN_TIMEOUT_MS = 15 * 60 * 1_000;
const POLL_INTERVAL_MS = 15_000;

export type MLBJobType = "accept-transfer" | "transfer-to-buyer";

export interface MLBJobParams {
  listingId: string;
  buyerEmail?: string;   // required for transfer-to-buyer
}

// ARNs for the three MLB Ballpark split APKs (base + arm64 + xxhdpi)
const BALLPARK_BASE_ARN = "arn:aws:devicefarm:us-west-2:768309077680:upload:df30cdff-cddf-42a7-977d-4997188d3e2d/c5452f6a-cd48-42b3-aba5-cbf1978faec6";
const BALLPARK_ARM64_ARN = "arn:aws:devicefarm:us-west-2:768309077680:upload:df30cdff-cddf-42a7-977d-4997188d3e2d/d8816395-1a81-412c-a5be-e512cb22b4a6";
const BALLPARK_XXHDPI_ARN = "arn:aws:devicefarm:us-west-2:768309077680:upload:df30cdff-cddf-42a7-977d-4997188d3e2d/2ca55f08-1129-4b5e-acdf-16d3b820c689";

function makeTestSpec(
  baseUrl: string,
  arm64Url: string,
  xxhdpiUrl: string,
  jobType: MLBJobType,
  envVars: Record<string, string>
): string {
  const exports = Object.entries(envVars)
    .map(([k, v]) => `      - export ${k}='${v}'`)
    .join("\n");

  return `version: 0.1
phases:
  install:
    commands:
      - adb uninstall com.bamnetworks.mobile.android.ballpark || true
      - curl -L -o /tmp/mlb-base.apk '${baseUrl}'
      - curl -L -o /tmp/mlb-arm64.apk '${arm64Url}'
      - curl -L -o /tmp/mlb-xxhdpi.apk '${xxhdpiUrl}'
      - adb install-multiple /tmp/mlb-base.apk /tmp/mlb-arm64.apk /tmp/mlb-xxhdpi.apk
      - adb shell am start -n com.bamnetworks.mobile.android.ballpark/com.bamnetworks.mobile.android.ballpark.activity.MainActivity
      - sleep 20
  pre_test:
    commands:
      - export PATH=$PATH:/home/device-farm/.npm-packages/bin
      - cd $DEVICEFARM_TEST_PACKAGE_PATH
      - npm install --legacy-peer-deps 2>/dev/null || true
      - npm install -g appium || true
      - export PATH=$PATH:/home/device-farm/.npm-packages/bin
      - appium driver list --installed
      - appium driver install uiautomator2 || appium driver install uiautomator2@2
      - appium driver list --installed
      - appium --address 127.0.0.1 --port 4723 --base-path /wd/hub --log /tmp/appium.log &
      - sleep 10
      - curl -s http://127.0.0.1:4723/status
  test:
    commands:
      - export PATH=$PATH:/home/device-farm/.npm-packages/bin
${exports}
      - cd $DEVICEFARM_TEST_PACKAGE_PATH
      - node $DEVICEFARM_TEST_PACKAGE_PATH/${jobType}.js
  post_test:
    commands:
      - tail -80 /tmp/appium.log || true
      - echo done
artifacts:
  - $DEVICEFARM_LOG_PATH
`;
}

/**
 * Upload a string as a Device Farm upload and wait for SUCCEEDED.
 */
async function uploadContent(
  name: string,
  type: UploadType,
  content: string | Buffer
): Promise<string> {
  const { upload } = await client.send(new CreateUploadCommand({
    projectArn: PROJECT_ARN,
    name,
    type,
  }));

  if (!upload?.url || !upload.arn) throw new Error(`Device Farm upload URL missing for ${name}`);

  const res = await fetch(upload.url, {
    method: "PUT",
    body: content instanceof Buffer ? new Uint8Array(content) : content as string,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Failed to upload ${name}: ${res.status}`);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const { upload: u } = await client.send(new GetUploadCommand({ arn: upload.arn }));
    if (u?.status === "SUCCEEDED") return upload.arn;
    if (u?.status === "FAILED") throw new Error(`Device Farm upload processing failed for ${name}`);
  }

  throw new Error(`Device Farm upload timed out for ${name}`);
}

/**
 * Schedule and wait for an Appium test run on a real Android device.
 */
export async function runMLBJob(
  jobType: MLBJobType,
  params: MLBJobParams
): Promise<{ success: boolean; message: string }> {
  console.log(`[DeviceFarm] Starting job: ${jobType}`, params);

  // Get fresh presigned download URLs for all 3 MLB Ballpark split APKs (valid 24h)
  const [{ upload: baseUpload }, { upload: arm64Upload }, { upload: xxhdpiUpload }] = await Promise.all([
    client.send(new GetUploadCommand({ arn: BALLPARK_BASE_ARN })),
    client.send(new GetUploadCommand({ arn: BALLPARK_ARM64_ARN })),
    client.send(new GetUploadCommand({ arn: BALLPARK_XXHDPI_ARN })),
  ]);
  const baseUrl = baseUpload?.url ?? "";
  const arm64Url = arm64Upload?.url ?? "";
  const xxhdpiUrl = xxhdpiUpload?.url ?? "";
  if (!baseUrl || !arm64Url || !xxhdpiUrl) console.warn("[DeviceFarm] WARNING: Could not get one or more ballpark APK URLs");

  // Build test package zip from the JS file
  const zipPath = require("path").join(process.cwd(), "scripts", "appium", `${jobType}.zip`);
  const zipBuffer = require("fs").readFileSync(zipPath);

  // Build env vars first so they can be embedded in the test spec YAML
  const envVars: Record<string, string> = {
    MLB_DEPOSITS_EMAIL: process.env.MLB_DEPOSITS_EMAIL!,
    MLB_DEPOSITS_PASSWORD: process.env.MLB_DEPOSITS_PASSWORD!,
    LISTING_ID: params.listingId,
    ...(params.buyerEmail ? { BUYER_EMAIL: params.buyerEmail } : {}),
  };

  const [testPackageArn, testSpecArn] = await Promise.all([
    uploadContent(
      `${jobType}-${Date.now()}.zip`,
      UploadType.APPIUM_NODE_TEST_PACKAGE,
      zipBuffer
    ),
    uploadContent(
      `${jobType}-spec-${Date.now()}.yaml`,
      UploadType.APPIUM_NODE_TEST_SPEC,
      makeTestSpec(baseUrl, arm64Url, xxhdpiUrl, jobType, envVars)
    ),
  ]);

  const { run } = await client.send(new ScheduleRunCommand({
    projectArn: PROJECT_ARN,
    devicePoolArn: DEVICE_POOL_ARN,
    appArn: DUMMY_APP_ARN,
    name: `buzzerseats-${jobType}-${params.listingId.slice(-8)}`,
    test: {
      type: "APPIUM_NODE",
      testPackageArn,
      testSpecArn,
      parameters: envVars,
    },
    executionConfiguration: {
      jobTimeoutMinutes: 15,
      videoCapture: false,
    },
  }));

  if (!run?.arn) throw new Error("Device Farm did not return a run ARN");

  console.log(`[DeviceFarm] Run scheduled: ${run.arn}`);

  // Poll until done or timeout
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const { run: current } = await client.send(new GetRunCommand({ arn: run.arn }));
    const status = current?.status;
    const result = current?.result;

    console.log(`[DeviceFarm] Run status: ${status} result: ${result}`);

    const terminalStatuses: ExecutionStatus[] = [
      ExecutionStatus.COMPLETED,
      ExecutionStatus.STOPPING,
    ];

    if (status && terminalStatuses.includes(status)) {
      const success = result === ExecutionResult.PASSED;
      return {
        success,
        message: success
          ? `${jobType} completed successfully`
          : `${jobType} failed with result: ${result}`,
      };
    }
  }

  return { success: false, message: `${jobType} timed out after 15 minutes` };
}
