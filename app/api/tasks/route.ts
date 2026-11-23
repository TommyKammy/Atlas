import { NextResponse } from "next/server";
import { createTask } from "@/lib/services/task-create";
import { withUser } from "@/lib/api/route";

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const result = await createTask({ uid, source: "web" }, body);
  return NextResponse.json(result, { status: 201 });
});
