/**
 * Start the automation outbox poller for the Node server runtime.
 * The engine itself lives behind /api/automation/process so the domain and
 * worker only share an HTTP contract; multiple instances may poll safely.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.AUTOMATION_WORKER_DISABLED === "1") return;

  const port =
    process.env.PORT ||
    process.env.APP_PORT ||
    "3000";
  const base =
    process.env.AUTOMATION_WORKER_URL ||
    process.env.APP_URL ||
    `http://127.0.0.1:${port}`;
  const token = process.env.AUTOMATION_WORKER_TOKEN || "atlas-internal-automation";

  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await fetch(`${base}/api/automation/process?limit=20`, {
        method: "POST",
        headers: token ? { "x-automation-token": token } : undefined,
        cache: "no-store",
      });
    } catch {
      // The app may still be starting; the next tick retries.
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), 2000);
  timer.unref?.();
  setTimeout(() => void tick(), 2500).unref?.();
  console.log(`[automation] worker polling ${base}`);
}
