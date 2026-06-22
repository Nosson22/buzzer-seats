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

const client = new DeviceFarmClient({ region: process.env.AWS_REGION ?? "us-west-2" });

const PROJECT_ARN = process.env.AWS_DEVICE_FARM_PROJECT_ARN!;
const DEVICE_POOL_ARN = process.env.AWS_DEVICE_FARM_DEVICE_POOL_ARN!;
const APP_ARN = process.env.AWS_DEVICE_FARM_APP_ARN!;
const EXTRA_DATA_ARN = process.env.AWS_DEVICE_FARM_EXTRA_DATA_ARN!;

// How long to wait for a run to finish (15 minutes max)
const RUN_TIMEOUT_MS = 15 * 60 * 1_000;
const POLL_INTERVAL_MS = 15_000;

export type MLBJobType = "accept-transfer" | "transfer-to-buyer";

export interface MLBJobParams {
  listingId: string;
  buyerEmail?: string;   // required for transfer-to-buyer
}

// Test spec YAML: installs all split APKs via adb install-multiple, then runs the Appium test
const TEST_SPEC_YAML = `version: 0.1
phases:
  install:
    commands:
      - adb uninstall com.bamnetworks.mobile.android.ballpark || true
      - adb install-multiple "$DEVICEFARM_EXTRA_DATA_PATH/base.apk" "$DEVICEFARM_EXTRA_DATA_PATH/config.arm64_v8a.apk" "$DEVICEFARM_EXTRA_DATA_PATH/config.xxhdpi.apk"
  pre_test:
    commands:
      - cd $DEVICEFARM_TEST_PACKAGE_PATH
      - npm install --legacy-peer-deps 2>/dev/null || true
  test:
    commands:
      - cd $DEVICEFARM_TEST_PACKAGE_PATH
      - node $DEVICEFARM_TEST_PACKAGE_PATH/accept-transfer.js
  post_test:
    commands:
      - echo "Test complete"
artifacts:
  - $DEVICEFARM_LOG_PATH
`;

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

  // Build test package zip from the JS file
  const zipPath = require("path").join(process.cwd(), "scripts", "appium", `${jobType}.zip`);
  const zipBuffer = require("fs").readFileSync(zipPath);

  const [testPackageArn, testSpecArn] = await Promise.all([
    uploadContent(
      `${jobType}-${Date.now()}.zip`,
      UploadType.APPIUM_NODE_TEST_PACKAGE,
      zipBuffer
    ),
    uploadContent(
      `${jobType}-spec-${Date.now()}.yaml`,
      UploadType.APPIUM_NODE_TEST_SPEC,
      TEST_SPEC_YAML
    ),
  ]);

  // Pass dynamic params as environment variables into the Appium test
  const envVars: Record<string, string> = {
    MLB_DEPOSITS_EMAIL: process.env.MLB_DEPOSITS_EMAIL!,
    MLB_DEPOSITS_PASSWORD: process.env.MLB_DEPOSITS_PASSWORD!,
    LISTING_ID: params.listingId,
    ...(params.buyerEmail ? { BUYER_EMAIL: params.buyerEmail } : {}),
  };

  const { run } = await client.send(new ScheduleRunCommand({
    projectArn: PROJECT_ARN,
    devicePoolArn: DEVICE_POOL_ARN,
    name: `buzzerseats-${jobType}-${params.listingId.slice(-8)}`,
    test: {
      type: "APPIUM_NODE",
      testPackageArn,
      testSpecArn,
      parameters: envVars,
    },
    configuration: {
      extraDataPackageArn: EXTRA_DATA_ARN,
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
