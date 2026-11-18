import { AVATAR_COLORS } from "@/lib/data-colors";

export default function UserAvatar({
  name,
  url,
  className = "h-7 w-7",
  textClassName = "text-[11px]",
}: {
  name: string | null | undefined;
  url?: string | null;
  className?: string;
  textClassName?: string;
}) {
  const label = name?.trim() || "?";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={label}
        title={label}
        className={`${className} shrink-0 rounded-full border border-data-line object-cover`}
      />
    );
  }
  const code = label.charCodeAt(0) || 0;
  return (
    <span
      title={label}
      className={`${className} ${textClassName} flex shrink-0 items-center justify-center rounded-full font-bold text-text ${AVATAR_COLORS[code % AVATAR_COLORS.length]}`}
    >
      {label.slice(0, 1)}
    </span>
  );
}
