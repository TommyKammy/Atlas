"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pingInbox } from "./InboxLive";
import { secondaryButtonClass, smallQuietButtonClass } from "./ui/form-controls";

export function MarkReadButton({
  commentId,
  eventId,
}: {
  commentId?: number;
  eventId?: number;
}) {
  const router = useRouter();
  const mark = async () => {
    await fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        eventId !== undefined ? { event_id: eventId } : { comment_id: commentId },
      ),
    });
    router.refresh();
    pingInbox();
  };
  return (
    <button onClick={mark} className={smallQuietButtonClass}>
      既読にする
    </button>
  );
}

export function MarkAllReadButton({ workspaceId }: { workspaceId: number }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const mark = async () => {
    const res = await fetch("/api/inbox/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, workspace_id: workspaceId }),
    });
    if (res.ok) {
      setDone(true);
      router.refresh();
      pingInbox();
    }
  };
  return (
    <button onClick={mark} className={`${secondaryButtonClass} whitespace-nowrap`}>
      {done ? "既読にしました" : "すべて既読にする"}
    </button>
  );
}
