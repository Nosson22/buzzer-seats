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
  }
}
