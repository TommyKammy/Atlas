/** Stop accepting HTTP/automation work, drain SMTP, then close the shared pool. */
export function installServerShutdown({ server, sockets, worker, pool, signals = process,
  exit = (code) => process.exit(code), timeoutMs = 8000, log = console.error }) {
  let shutdown = null;
  const stop = () => {
    if (shutdown) return shutdown;
    // stop() synchronously disables new claims before its first await.
    const workerDone = worker.stop();
    const httpDone = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      for (const socket of sockets.clients) socket.terminate();
    });
    const deadline = setTimeout(() => {
      log("server shutdown timed out; in-flight email delivery status may be unknown");
      exit(1);
    }, timeoutMs);
    shutdown = Promise.all([workerDone, httpDone]).then(() => pool.end())
      .then(() => { clearTimeout(deadline); exit(0); }, () => {
        clearTimeout(deadline); log("server shutdown failed"); exit(1);
      });
    return shutdown;
  };
  signals.on("SIGTERM", stop);
  signals.on("SIGINT", stop);
  return stop;
}
