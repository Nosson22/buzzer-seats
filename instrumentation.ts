/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to boot BullMQ workers inside the same Railway service.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMLBAutomationWorker } = await import("./lib/queue/mlb-automation.worker");
    await import("./lib/queue/expiry.worker"); // self-registers on import

    startMLBAutomationWorker();
    console.log("[Instrumentation] BullMQ workers started");

    // Auto-configure Postmark inbound webhook URL on every deploy
    const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://buzzerseats.com";
    if (postmarkToken) {
      try {
        const res = await fetch("https://api.postmarkapp.com/server", {
          method: "PUT",
          headers: {
            "X-Postmark-Server-Token": postmarkToken,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({ InboundHookUrl: `${appUrl}/api/inbound/email` }),
        });
        if (res.ok) {
          console.log("[Instrumentation] Postmark inbound webhook configured:", `${appUrl}/api/inbound/email`);
        } else {
          console.warn("[Instrumentation] Postmark webhook config failed:", await res.text());
        }
      } catch (err: any) {
        console.warn("[Instrumentation] Postmark webhook config error:", err.message);
      }
    } else {
      console.warn("[Instrumentation] POSTMARK_SERVER_TOKEN not set — inbound emails won't be processed automatically");
    }
  }
}
