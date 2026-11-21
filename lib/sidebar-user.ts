import { cache } from "react";
import { db } from "./db";
import { getCurrentUserId } from "./current-user";

/**
 * The account shown by the sidebar/top-bar menu. This includes the
 * out-of-office fields the menu edits, which `getUsers()` does not return.
 */
export type SidebarUser = {
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  is_admin: boolean;
  out_of_office_from: string | null;
  out_of_office_to: string | null;
  out_of_office_note: string | null;
};

/** Request-scoped cache: the shell and its sidebars share one lookup. */
export const getSidebarUser = cache(async (): Promise<SidebarUser | null> => {
  const uid = await getCurrentUserId();
  if (uid === null) return null;
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url,
       COALESCE(r.base_level = 'guest', u.is_guest) AS is_guest,
       COALESCE(r.base_level = 'admin', u.is_admin) AS is_admin,
       u.out_of_office_from::text AS out_of_office_from,
       u.out_of_office_to::text AS out_of_office_to,
       u.out_of_office_note
     FROM users u LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.deactivated_at IS NULL`,
    [uid],
  );
  return (result.rows[0] as SidebarUser | undefined) ?? null;
});
