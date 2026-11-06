import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import SidebarHelpButton from "./SidebarHelpButton";
import SidebarUserMenu from "./SidebarUserMenu";

export default async function SidebarRailFooter() {
  const uid = await getCurrentUserId();
  const user =
    uid === null
      ? undefined
      : (
          await db.query(
            `SELECT id, name, email, title, avatar_url, is_guest, is_admin,
               out_of_office_from::text AS out_of_office_from,
               out_of_office_to::text AS out_of_office_to,
               out_of_office_note
             FROM users WHERE id = $1 AND deactivated_at IS NULL`,
            [uid],
          )
        ).rows[0];
  return (
    <div className="mt-auto flex flex-col items-center gap-3 border-t border-white/10 pb-2 pt-2">
      <SidebarHelpButton />
      {user && <SidebarUserMenu user={user} />}
    </div>
  );
}
