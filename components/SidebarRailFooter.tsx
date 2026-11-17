import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import SidebarHelpButton from "./SidebarHelpButton";
import SidebarUserMenu from "./SidebarUserMenu";
import ThemeToggle from "./ThemeToggle";

export default async function SidebarRailFooter({ theme }: { theme: "light" | "dark" }) {
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
    <div data-sidebar-rail-footer className="mt-auto flex flex-col items-center gap-3 pb-2 pt-2">
      <ThemeToggle initialTheme={theme} />
      <SidebarHelpButton />
      {user && <SidebarUserMenu user={user} />}
    </div>
  );
}
