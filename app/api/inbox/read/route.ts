import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { markInboxRead } from "@/lib/notification-feed";

// Mark feed entries as read for the current user.
// Body: { comment_id } | { event_id } | { all: true, workspace_id }
export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const { comment_id, event_id, all, workspace_id } = body ?? {};
  const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (all) {
    if (!positive(workspace_id) || comment_id !== undefined || event_id !== undefined) {
      return NextResponse.json({ error: "workspace_id is required for all" }, { status: 400 });
    }
    const result = await markInboxRead(uid, { workspaceId: workspace_id });
    return NextResponse.json({ marked: result.marked });
  }
  if ((positive(comment_id) && event_id === undefined) || (positive(event_id) && comment_id === undefined)) {
    const result = await markInboxRead(uid, comment_id === undefined ? { eventId: event_id } : { commentId: comment_id });
    if (!result.visible) return NextResponse.json({ error: "notification not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "comment_id, event_id or all is required" }, { status: 400 });
});
