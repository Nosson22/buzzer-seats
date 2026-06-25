import { NextRequest, NextResponse } from "next/server";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "buzzer-admin-2026";
const SG_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const pageUrl = body.pageUrl ?? "https://seatgeek.com/transfers/38406692/a35ddf56c47c33d1afbc07155141faad899c4b4b";
  const apiKey = process.env.CAPSOLVER_API_KEY;
  const proxy = process.env.WEBSHARE_PROXY;
  const sessionCookie = process.env.SEATGEEK_SESSION_COOKIE;

  const log: string[] = [];
  log.push(`pageUrl: ${pageUrl}`);
  log.push(`apiKey set: ${!!apiKey}`);
  log.push(`proxy set: ${!!proxy} (${proxy ?? "MISSING"})`);
  log.push(`sessionCookie set: ${!!sessionCookie}`);

  // Step 1: probe page
  let challengeUrl: string | null = null;
  let probeStatus: number | null = null;
  let probeBody = "";
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": SG_USER_AGENT, "Accept": "application/json" },
    });
    probeStatus = res.status;
    probeBody = (await res.text()).slice(0, 500);
    log.push(`probe status: ${probeStatus}`);
    log.push(`probe body (500 chars): ${probeBody}`);
    try {
      const parsed = JSON.parse(probeBody);
      challengeUrl = parsed.url ?? null;
    } catch {
      const m = probeBody.match(/"url"\s*:\s*"(https:\/\/geo\.captcha-delivery\.com[^"]+)"/);
      if (m) challengeUrl = m[1];
    }
    log.push(`challengeUrl: ${challengeUrl ?? "none found"}`);
  } catch (e: any) {
    log.push(`probe error: ${e.message}`);
  }

  if (!challengeUrl) {
    return NextResponse.json({ log, error: "No DataDome challenge URL found in probe response" });
  }

  if (!apiKey || !proxy) {
    return NextResponse.json({ log, error: "Missing CAPSOLVER_API_KEY or WEBSHARE_PROXY" });
  }

  // Step 2: create CapSolver task
  let taskId: string | null = null;
  try {
    const createRes = await fetch("https://api.capsolver.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: "DatadomeSliderTask",
          websiteURL: pageUrl,
          captchaUrl: challengeUrl,
          userAgent: SG_USER_AGENT,
          proxy,
        },
      }),
    });
    const createData = await createRes.json() as any;
    log.push(`CapSolver createTask: ${JSON.stringify(createData)}`);
    if (createData.errorId) {
      return NextResponse.json({ log, error: `CapSolver error: ${createData.errorDescription}` });
    }
    taskId = createData.taskId;
  } catch (e: any) {
    return NextResponse.json({ log, error: `CapSolver createTask exception: ${e.message}` });
  }

  // Step 3: poll once (3s)
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const result = await resultRes.json() as any;
    log.push(`CapSolver result (4s): ${JSON.stringify(result)}`);
    return NextResponse.json({ log, taskId, result });
  } catch (e: any) {
    return NextResponse.json({ log, error: `CapSolver getTaskResult exception: ${e.message}` });
  }
}
