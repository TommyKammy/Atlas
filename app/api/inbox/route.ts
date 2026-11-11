import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { getInboxPage } from "@/lib/notification-feed";
import { inboxFilter, parseInboxCursor } from "@/lib/inbox-pagination";
import { badRequest } from "@/lib/api/errors";

export const GET = withUser(async (req, { uid }) => {
  const params = new URL(req.url).searchParams;
  let cursor;
  try { cursor = parseInboxCursor(params.get("cursor")); } catch { throw badRequest("invalid inbox cursor"); }
  const workspace = await getWorkspace();
  if (!workspace) return NextResponse.json({ items: [], total: 0, unread: 0, read: 0, all: 0, nextCursor: null });
  return NextResponse.json(await getInboxPage(uid, workspace.id, { filter: inboxFilter(params.get("filter")), cursor }),
    { headers: { "Cache-Control": "no-store" } });
});
