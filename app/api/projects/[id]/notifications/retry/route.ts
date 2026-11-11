import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { db } from "@/lib/db";
import { notificationMailConfig } from "@/lib/notification-mail.mjs";
import { requeueNotificationEmails } from "@/lib/notification-email-worker.mjs";

export const POST = withProject("admin", async (_req, { projectId }) => {
  if (!notificationMailConfig().configured) return NextResponse.json({ error: "SMTPとAPP_URLを設定してから再試行してください" }, { status: 400 });
  return NextResponse.json({ requeued: await requeueNotificationEmails(db, projectId) });
});
