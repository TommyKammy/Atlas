import { redirect } from "next/navigation";
import { getServerSession, SESSION_COOKIE } from "./api/session";

export const COOKIE_NAME = SESSION_COOKIE;

/** Server-component view of the validated session. */
export async function getCurrentUserId(): Promise<number | null> {
  const session = await getServerSession();
  return session?.id ?? null;
}

export async function requirePageUser() {
  const user = await getServerSession();
  if (!user) redirect("/login");
  return user;
}
