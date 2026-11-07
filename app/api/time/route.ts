import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import { todayISO } from "@/lib/dates";
import { db } from "@/lib/db";

export const GET = withUser(async (req) => {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("at");
  const at = raw ? new Date(raw) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "at must be an ISO timestamp" }, { status: 400 });
  }
  const r = await db.query(
    `SELECT current_setting('TimeZone') AS session_timezone,
       (now() AT TIME ZONE 'Asia/Tokyo')::date::text AS db_today,
       (now() AT TIME ZONE 'UTC')::date::text AS utc_today`,
  );
  return NextResponse.json({
    timezone: "Asia/Tokyo",
    at: at.toISOString(),
    today: todayISO(at),
    db_today: r.rows[0].db_today,
    utc_today: r.rows[0].utc_today,
    session_timezone: r.rows[0].session_timezone,
  });
});
