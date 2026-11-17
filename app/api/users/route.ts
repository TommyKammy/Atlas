import { NextResponse } from "next/server";
import { getUsers } from "@/lib/data";
import { withUser } from "@/lib/api/route";

export const GET = withUser(async (_req, { uid }) => {
  const rows = await getUsers(uid);
  const users = rows.map(({ id, name, email, title, avatar_url, is_guest, is_admin }) =>
    ({ id, name, email, title, avatar_url, is_guest, is_admin }));
  return NextResponse.json({ users });
});
