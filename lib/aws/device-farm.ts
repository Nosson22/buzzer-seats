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
import { readFileSync } from "fs";
import { join } from "path";
import { deflateRawSync } from "zlib";

const client = new DeviceFarmClient({ region: process.env.AWS_REGION ?? "us-west-2" });

const PROJECT_ARN = process.env.AWS_DEVICE_FARM_PROJECT_ARN!;
const DEVICE_POOL_ARN = process.env.AWS_DEVICE_FARM_DEVICE_POOL_ARN!;
const APP_ARN = process.env.AWS_DEVICE_FARM_APP_ARN!;
const EXTRA_DATA_ARN = process.env.AWS_DEVICE_FARM_EXTRA_DATA_ARN!;

const RUN_TIMEOUT_MS = 15 * 60 * 1_000;
const POLL_INTERVAL_MS = 15_000;

export type MLBJobType = "accept-transfer" | "transfer-to-buyer";

export interface MLBJobParams {
  listingId: string;
  buyerEmail?: string;
}

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(filename: string, content: Buffer): Buffer {
  const nameBytes = Buffer.from(filename, "utf8");
  const deflated = deflateRawSync(content, { level: 6 });
  const checksum = crc32(content);
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const lfh = Buffer.alloc(30 + nameBytes.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(checksum, 14);
  lfh.writeUInt32LE(deflated.length, 18);
  lfh.writeUInt32LE(content.length, 22);
  lfh.writeUInt16LE(nameBytes.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBytes.copy(lfh, 30);

  const cdOffset = lfh.length + deflated.length;

  const cdh = Buffer.alloc(46 + nameBytes.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(checksum, 16);
  cdh.writeUInt32LE(deflated.length, 20);
  cdh.writeUInt32LE(content.length, 24);
  cdh.writeUInt16LE(nameBytes.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);
  nameBytes.copy(cdh, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, deflated, cdh, eocd]);
}

async function waitForUpload(arn: string): Promise<void> {
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const { upload } = await client.send(new GetUploadCommand({ arn }));
    if (upload?.status === "SUCCEEDED") return;
    if (upload?.status === "FAILED") throw new Error(`Device Farm upload failed: ${upload.message}`);
  }
  throw new Error("Device Farm upload timed out during processing");
}

async function putUpload(url: string, body: Buffer): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Upload PUT failed: ${res.status}`);
}

async function uploadTestPackage(jobType: MLBJobType): Promise<string> {
  const jsContent = readFileSync(join(process.cwd(), "scripts", "appium", `${jobType}.js`));
  const zipBuffer = buildZip(`${jobType}.js`, jsContent);

  const { upload } = await client.send(new CreateUploadCommand({
    projectArn: PROJECT_ARN,
    name: `${jobType}-${Date.now()}.zip`,
    type: UploadType.APPIUM_NODE_TEST_PACKAGE,
  }));
  if (!upload?.url || !upload.arn) throw new Error("No upload URL for test package");

  await putUpload(upload.url, zipBuffer);
  await waitForUpload(upload.arn);
  return upload.arn;
}

async function uploadTestSpec(jobType: MLBJobType): Promise<string> {
  // Install all split APKs together before running the Appium test.
  // Split APKs are in EXTRA_DATA_PATH (uploaded as EXTERNAL_DATA).
  const specYaml = [
    "version: 0.1",
    "phases:",
    "  install:",
    "    commands:",
    "      - adb uninstall com.bamnetworks.mobile.android.ballpark || true",
    '      - adb install-multiple "$DEVICEFARM_APP_PATH" "$DEVICEFARM_EXTRA_DATA_PATH/config.arm64_v8a.apk" "$DEVICEFARM_EXTRA_DATA_PATH/config.xxhdpi.apk"',
    "      - cd $DEVICEFARM_TEST_PACKAGE_PATH",
    "      - npm install --production 2>/dev/null || true",
    "  test:",
    "    commands:",
    `      - cd $DEVICEFARM_TEST_PACKAGE_PATH && node ${jobType}.js`,
    "  post_test:",
    "    commands:",
    "      - echo done",
    "artifacts:",
    "  - $DEVICEFARM_LOG_DIR",
  ].join("\n");

  const specBuffer = Buffer.from(specYaml, "utf8");

  const { upload } = await client.send(new CreateUploadCommand({
    projectArn: PROJECT_ARN,
    name: `${jobType}-spec-${Date.now()}.yml`,
    type: UploadType.APPIUM_NODE_TEST_SPEC,
  }));
  if (!upload?.url || !upload.arn) throw new Error("No upload URL for test spec");

  await putUpload(upload.url, specBuffer);
  await waitForUpload(upload.arn);
  return upload.arn;
}

export async function runMLBJob(
  jobType: MLBJobType,
  params: MLBJobParams
): Promise<{ success: boolean; message: string }> {
  console.log(`[DeviceFarm] Starting job: ${jobType}`, params);

  const [testPackageArn, testSpecArn] = await Promise.all([
    uploadTestPackage(jobType),
    uploadTestSpec(jobType),
  ]);

  const envVars: Record<string, string> = {
    MLB_DEPOSITS_EMAIL: process.env.MLB_DEPOSITS_EMAIL!,
    MLB_DEPOSITS_PASSWORD: process.env.MLB_DEPOSITS_PASSWORD!,
    LISTING_ID: params.listingId,
    ...(params.buyerEmail ? { BUYER_EMAIL: params.buyerEmail } : {}),
  };

  const { run } = await client.send(new ScheduleRunCommand({
    projectArn: PROJECT_ARN,
    appArn: APP_ARN,
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

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { run: current } = await client.send(new GetRunCommand({ arn: run.arn }));
    const status = current?.status;
    const result = current?.result;
    console.log(`[DeviceFarm] Run status: ${status} result: ${result}`);
    const terminalStatuses: ExecutionStatus[] = [ExecutionStatus.COMPLETED, ExecutionStatus.STOPPING];
    if (status && terminalStatuses.includes(status)) {
      const success = result === ExecutionResult.PASSED;
      return {
        success,
        message: success ? `${jobType} completed successfully` : `${jobType} failed: ${result}`,
      };
    }
  }

  return { success: false, message: `${jobType} timed out after 15 minutes` };
}
