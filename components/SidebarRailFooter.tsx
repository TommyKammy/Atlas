import SidebarHelpButton from "./SidebarHelpButton";
import SidebarToggle from "./SidebarToggle";
import ThemeToggle from "./ThemeToggle";

export default function SidebarRailFooter({
  theme,
  variant = "rail",
}: {
  theme: "light" | "dark";
  /** "rail" is the collapsed icon column; "panel" is the expanded sidebar footer row. */
  variant?: "rail" | "panel";
}) {
  if (variant === "panel") {
    return (
      <div className="flex items-center gap-2 px-1 pb-1">
        <ThemeToggle initialTheme={theme} />
        <SidebarHelpButton />
        <div className="ml-auto">
          <SidebarToggle initialCollapsed={false} />
        </div>
      </div>
    );
  }
  return (
    <div data-sidebar-rail-footer className="mt-auto flex flex-col items-center gap-2 pb-2 pt-2">
      <ThemeToggle initialTheme={theme} />
      <SidebarHelpButton />
      <SidebarToggle initialCollapsed />
    </div>
  );
}
