import { AsyncLocalStorage } from "node:async_hooks";

/**
 * How a write reached Atlas. `web` is the implicit default for ordinary
 * session-backed requests; MCP tools run inside an explicit `mcp` context so
 * the audit log and task history can attribute the write without threading
 * parameters through every service function.
 */
export type RequestVia = "web" | "mcp" | "automation";

export type RequestContext = {
  via: RequestVia;
  /** The mcp_tokens row that authorized the call (MCP only). */
  tokenId?: number | null;
  /** The MCP client name, when the request supplied one. */
  clientName?: string | null;
};

// AsyncLocalStorage is per async execution chain, so concurrent Route Handler
// requests and automation jobs never share a context.
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attribution columns for task history. Direct task_events writers and
 * logEvent share this so an MCP write is never recorded as a web write.
 */
export function taskEventAttribution(): { via: RequestVia; clientName: string | null } {
  const context = getRequestContext();
  return {
    via: context?.via ?? "web",
    clientName: context?.clientName ?? null,
  };
}
