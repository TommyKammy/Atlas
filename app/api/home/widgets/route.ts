import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { isHomeWidgetSize, isHomeWidgetType } from "@/lib/home-widgets";
import { addHomeWidget, getHomeWidgets, reorderHomeWidgets } from "@/lib/repositories/home";

async function workspaceId() {
  const ws = await getWorkspace();
  return ws?.id ?? 1;
}

export const GET = withUser(async (_req, { uid }) => {
  const wsId = await workspaceId();
  return NextResponse.json({ widgets: await getHomeWidgets(wsId, uid) });
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const payload = (body ?? {}) as { widget_type?: unknown; size?: unknown };
  if (!isHomeWidgetType(payload.widget_type)) {
    return NextResponse.json({ error: "invalid widget_type" }, { status: 400 });
  }
  const size = isHomeWidgetSize(payload.size) ? payload.size : "half";
  const wsId = await workspaceId();
  return NextResponse.json(
    { widgets: await addHomeWidget(wsId, uid, payload.widget_type, size) },
    { status: 201 },
  );
});

export const PATCH = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const payload = (body ?? {}) as { order?: unknown };
  if (!Array.isArray(payload.order)) {
    return NextResponse.json({ error: "order must be an array" }, { status: 400 });
  }
  const wsId = await workspaceId();
  return NextResponse.json({
    widgets: await reorderHomeWidgets(
      wsId,
      uid,
      payload.order.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    ),
  });
});
