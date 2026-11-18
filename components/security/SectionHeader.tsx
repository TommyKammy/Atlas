"use client";

export const field =
  "mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
    </div>
  );
}
