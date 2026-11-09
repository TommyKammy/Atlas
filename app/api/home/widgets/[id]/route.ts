import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { getWorkspace } from "@/lib/data";
import { isHomeWidgetSize } from "@/lib/home-widgets";
import {
  deleteHomeWidget,
  getHomeWidgets,
  updateHomeWidget,
} from "@/lib/repositories/home";

async function workspaceId() {
  const ws = await getWorkspace();
  return ws?.id ?? 1;
}

function widgetId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const PATCH = withUser(async (req, { uid, params }) => {
  const id = widgetId(params.id);
  if (id === null) return NextResponse.json({ error: "invalid widget id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const payload = (body ?? {}) as { size?: unknown; config?: unknown };
  if (payload.size !== undefined && !isHomeWidgetSize(payload.size)) {
    return NextResponse.json({ error: "invalid size" }, { status: 400 });
  }
  const wsId = await workspaceId();
  const existing = await getHomeWidgets(wsId, uid);
  if (!existing.some((widget) => widget.id === id)) {
    return NextResponse.json({ error: "widget not found" }, { status: 404 });
  }
  return NextResponse.json({
    widgets: await updateHomeWidget(wsId, uid, id, {
      size: payload.size as "half" | "full" | undefined,
      config:
        payload.config && typeof payload.config === "object" && !Array.isArray(payload.config)
          ? (payload.config as Record<string, unknown>)
          : undefined,
    }),
  });
});

export const DELETE = withUser(async (_req, { uid, params }) => {
  const id = widgetId(params.id);
  if (id === null) return NextResponse.json({ error: "invalid widget id" }, { status: 400 });
  const wsId = await workspaceId();
  const existing = await getHomeWidgets(wsId, uid);
  if (!existing.some((widget) => widget.id === id)) {
    return NextResponse.json({ error: "widget not found" }, { status: 404 });
  }
  return NextResponse.json({ widgets: await deleteHomeWidget(wsId, uid, id) });
});
