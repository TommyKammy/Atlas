"use client";

const UNSET_COLOR = "border-neutral-300 bg-neutral-100 text-neutral-600";

export default function CalendarLegend({
  colorKeys,
  colorFor,
}: {
  colorKeys: string[];
  colorFor: (key: string) => string;
}) {
  return (
    <div
      data-calendar-legend
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-200 px-4 py-1.5 text-[12px] text-neutral-600"
    >
      <span className="font-medium text-neutral-700">凡例</span>
      {colorKeys.map((key) => (
        <span key={key} data-calendar-legend-item={key} className="flex items-center gap-1">
          <span data-calendar-legend-swatch className={`h-3 w-3 rounded-sm border ${colorFor(key)}`} />
          {key}
        </span>
      ))}
      <span data-calendar-legend-item="unset" className="flex items-center gap-1">
        <span data-calendar-legend-swatch className={`h-3 w-3 rounded-sm border ${UNSET_COLOR}`} />
        未設定
      </span>
    </div>
  );
}
