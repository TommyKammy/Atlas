import type { Page } from "@playwright/test";

export type MemberLookupMode = "respect-abort" | "ignore-abort";
export type MemberLookupState = {
  oldStarted: number;
  oldAborted: number;
  oldJSONRead: number;
  currentStarted: number;
  currentJSONRead: number;
};

type LookupControl = {
  state: MemberLookupState;
  releaseOld: () => void;
  restore: () => void;
};

declare global {
  interface Window {
    __atlasMemberLookup?: LookupControl;
  }
}

/** Control only the membership picker's lookup transport, not browser routing. */
export async function installMemberLookup(page: Page, mode: MemberLookupMode) {
  await page.addInitScript(({ mode }) => {
    const originalFetch = window.fetch;
    const state: MemberLookupState = {
      oldStarted: 0, oldAborted: 0, oldJSONRead: 0, currentStarted: 0, currentJSONRead: 0,
    };
    let releaseOld = () => {};
    const released = new Promise<void>((resolve) => { releaseOld = resolve; });
    const jsonResponse = (body: unknown, consumed?: () => void) => {
      const response = new Response(JSON.stringify(body), {
        status: 200, headers: { "content-type": "application/json" },
      });
      const readJSON = response.json.bind(response);
      response.json = async () => {
        const value: unknown = await readJSON();
        consumed?.();
        return value;
      };
      return response;
    };
    const fetch: typeof window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin !== location.origin || url.pathname !== "/api/lookup" || method !== "GET") {
        return originalFetch.call(window, input, init);
      }
      if (!url.search) {
        return jsonResponse([
          { id: 9001, name: "Older project" }, { id: 9002, name: "Current project" },
        ]);
      }
      const project = url.searchParams.get("project_id");
      if (project === "9002") {
        state.currentStarted++;
        return jsonResponse([{ id: 9201, name: "Current project section" }], () => { state.currentJSONRead++; });
      }
      if (project !== "9001") return originalFetch.call(window, input, init);

      state.oldStarted++;
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((resolve, reject) => {
        let settled = false;
        const aborted = () => {
          state.oldAborted++;
          if (mode === "respect-abort" && !settled) {
            settled = true;
            signal?.removeEventListener("abort", aborted);
            reject(new DOMException("Superseded membership lookup", "AbortError"));
          }
        };
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
        void released.then(() => {
          signal?.removeEventListener("abort", aborted);
          if (settled) return;
          settled = true;
          resolve(jsonResponse([{ id: 9101, name: "Older project section" }], () => { state.oldJSONRead++; }));
        });
      });
    };
    window.fetch = fetch;
    window.__atlasMemberLookup = {
      state, releaseOld,
      restore: () => {
        releaseOld();
        if (window.fetch === fetch) window.fetch = originalFetch;
        delete window.__atlasMemberLookup;
      },
    };
  }, { mode });
}

export async function memberLookupState(page: Page): Promise<MemberLookupState> {
  return page.evaluate(() => {
    if (!window.__atlasMemberLookup) throw new Error("Membership lookup transport is not installed");
    return { ...window.__atlasMemberLookup.state };
  });
}

export async function releaseOldMemberLookup(page: Page) {
  await page.evaluate(() => {
    if (!window.__atlasMemberLookup) throw new Error("Membership lookup transport is not installed");
    window.__atlasMemberLookup.releaseOld();
  });
}

/** Let the client consume delayed JSON and commit its resulting React update. */
export async function memberLookupRenderCheckpoint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

export async function restoreMemberLookup(page: Page) {
  if (!page.isClosed()) await page.evaluate(() => window.__atlasMemberLookup?.restore());
}
