import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/api-project-auth";
import { getOutOfOffice } from "@/lib/data";
import { db } from "@/lib/db";

function dateOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function GET(req: Request) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  return NextResponse.json(await getOutOfOffice(active.uid));
}

export async function PATCH(req: Request) {
  const active = await requireActiveUser(req);
  if (!active.ok) return NextResponse.json({ error: active.error }, { status: active.status });
  const body = await req.json().catch(() => null);
  const from = dateOrNull(body?.from);
  const to = dateOrNull(body?.to);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : "";
  if (from === undefined || to === undefined) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD or null" }, { status: 400 });
  }
  if (from !== null && to !== null && from > to) {
    return NextResponse.json({ error: "from must be before to" }, { status: 400 });
  }
  await db.query(
    `UPDATE users SET out_of_office_from = $2::date, out_of_office_to = $3::date, out_of_office_note = $4
     WHERE id = $1`,
    [active.uid, from, to, note === "" ? null : note],
  );
  return NextResponse.json(await getOutOfOffice(active.uid));
}
