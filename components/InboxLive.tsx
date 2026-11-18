"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const INBOX_CHANNEL = "atlas-inbox";

export function pingInbox() {
  try {
    new BroadcastChannel(INBOX_CHANNEL).postMessage("changed");
  } catch {
    // unsupported environment
  }
}

// Cross-tab instant sync (BroadcastChannel) + 30s polling fallback so other
// devices and background tabs converge on read state.
export default function InboxLive() {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(INBOX_CHANNEL);
      ch.onmessage = () => {
        if (document.visibilityState === "visible") router.refresh();
      };
    } catch {
      ch = null;
    }
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30000);
    return () => {
      ch?.close();
      clearInterval(t);
    };
  }, [auto, router]);
  return (
    <label className="flex items-center gap-1 text-sm text-secondary" title="他タブと即時同期＋30秒ごとに自動更新">
      <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
      自動更新
    </label>
  );
}
