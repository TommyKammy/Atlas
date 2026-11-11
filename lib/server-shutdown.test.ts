import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installServerShutdown } from "./server-shutdown.mjs";

test("SIGTERM stops new work and drains SMTP before closing pool once", async () => {
  const calls: string[] = [];
  const signals = new EventEmitter();
  let finishMail!: () => void;
  let finishHttp!: () => void;
  const mail = new Promise<void>((resolve) => { finishMail = resolve; });
  const stop = installServerShutdown({ signals: signals as unknown as NodeJS.Process,
    worker: { stop: () => { calls.push("stop-claims"); return mail; } },
    server: { close: (done: () => void) => { calls.push("close-http"); finishHttp = done; } },
    sockets: { clients: [{ terminate: () => calls.push("close-ws") }] },
    pool: { end: async () => { calls.push("pool-end"); } },
    exit: ((code: number) => { calls.push(`exit-${code}`); }) as typeof process.exit,
  });
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  assert.deepEqual(calls, ["stop-claims", "close-http", "close-ws"]);
  finishHttp();
  await Promise.resolve();
  assert.equal(calls.includes("pool-end"), false);
  finishMail();
  await stop();
  assert.deepEqual(calls, ["stop-claims", "close-http", "close-ws", "pool-end", "exit-0"]);
});

test("shutdown deadline reports an unknown delivery instead of hanging", async () => {
  const calls: string[] = [];
  const stop = installServerShutdown({ signals: new EventEmitter() as unknown as NodeJS.Process, timeoutMs: 5,
    worker: { stop: () => new Promise<void>(() => {}) },
    server: { close: () => {} }, sockets: { clients: [] }, pool: { end: async () => {} },
    exit: ((code: number) => { calls.push(`exit-${code}`); }) as typeof process.exit, log: (message: string) => calls.push(message),
  });
  void stop();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls[1], "exit-1");
  assert.match(calls[0], /delivery status may be unknown/);
});
