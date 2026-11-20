import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import SidebarHelpButton from "./SidebarHelpButton";
import SidebarUserMenu from "./SidebarUserMenu";
import ThemeToggle from "./ThemeToggle";

export default async function SidebarRailFooter({
  theme,
  variant = "rail",
}: {
  theme: "light" | "dark";
  /** "rail" is the collapsed icon column; "panel" is the expanded sidebar footer row. */
  variant?: "rail" | "panel";
}) {
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
  if (variant === "panel") {
    return (
      <div className="flex items-center gap-2 px-1 pb-1">
        <ThemeToggle initialTheme={theme} />
        <SidebarHelpButton />
        {user && <SidebarUserMenu user={user} />}
      </div>
    );
  }
  return (
    <div data-sidebar-rail-footer className="mt-auto flex flex-col items-center gap-3 pb-2 pt-2">
      <ThemeToggle initialTheme={theme} />
      <SidebarHelpButton />
      {user && <SidebarUserMenu user={user} />}
    </div>
  );
}
