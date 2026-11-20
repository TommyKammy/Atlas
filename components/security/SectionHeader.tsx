"use client";

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[14px] font-semibold leading-5 text-text">{title}</h3>
      <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>
    </div>
  );
}
