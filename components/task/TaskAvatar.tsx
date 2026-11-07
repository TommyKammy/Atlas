import UserAvatar from "../UserAvatar";

/** Assignee avatar used by timeline bars, calendar bars, board cards and list rows. */
export default function TaskAvatar({
  name,
  url,
  className = "h-5 w-5",
  textClassName = "text-[10px]",
}: {
  name: string | null | undefined;
  url?: string | null;
  className?: string;
  textClassName?: string;
}) {
  if (!name) return null;
  return <UserAvatar name={name} url={url} className={className} textClassName={textClassName} />;
}
