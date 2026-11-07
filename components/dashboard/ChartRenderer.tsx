"use client";

import type { DashboardWidgetData } from "@/lib/dashboard-compute";
import type { DashboardChartType } from "@/lib/dashboard-types";

const COLORS = ["#9b8cff", "#37b97c", "#5b9cf8", "#f0a44b", "#e879a8"];

function truncate(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function niceTicks(maxValue: number): { max: number; values: number[] } {
  if (maxValue <= 4) {
    const top = Math.max(1, Math.ceil(maxValue));
    return { max: top, values: Array.from({ length: top + 1 }, (_, i) => i) };
  }
  const rough = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(maxValue / step) * step;
  const values: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) {
    values.push(Math.round(value * 100) / 100);
  }
  return { max: top, values };
}

function EmptyChart() {
  return (
    <div className="flex h-[250px] items-center justify-center rounded-md border border-dashed border-neutral-200 text-sm text-neutral-400">
      データがありません
    </div>
  );
}

function ChartFrame({
  children,
  height = 250,
}: {
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <svg
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label="チャート"
      className="h-auto w-full overflow-visible"
    >
      {children}
    </svg>
  );
}

function GridAndAxes({
  width,
  height,
  max,
  ticks,
  left = 42,
  right = 12,
  top = 18,
  bottom = 42,
}: {
  width: number;
  height: number;
  max: number;
  ticks: number[];
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}) {
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  return (
    <>
      {ticks.map((v, i) => {
        const y = top + plotH - (v / max) * plotH;
        return (
          <g key={i}>
            <line x1={left} x2={left + plotW} y1={y} y2={y} stroke="#ececec" strokeWidth="1" />
            <text x={left - 7} y={y + 3} textAnchor="end" fontSize="10" fill="#8a8a8a">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        );
      })}
      <line x1={left} x2={left} y1={top} y2={top + plotH} stroke="#d9d9d9" strokeWidth="1" />
    </>
  );
}

function CategoricalChart({ data, chartType }: { data: DashboardWidgetData; chartType: DashboardChartType }) {
  const categories = data.categories;
  if (categories.length === 0) return <EmptyChart />;
  const width = 640;
  const height = 260;
  const left = 42;
  const right = 12;
  const top = 20;
  const bottom = 46;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const seriesCount = Math.max(1, data.series.length);
  const scale = niceTicks(
    Math.max(1, ...categories.flatMap((c) => c.values), data.benchmark ?? 0),
  );
  const maxValue = scale.max;
  const band = plotW / categories.length;
  const barGroupWidth = Math.min(76, band * 0.66);
  const barWidth = Math.max(3, barGroupWidth / seriesCount - 3);
  const rotateLabels = categories.length > 6;
  const showLabels = data.dataLabels && categories.length <= 12;
  const multi = seriesCount > 1;
  const stacked = chartType === "stacked_bar";

  return (
    <ChartFrame height={height}>
      <GridAndAxes width={width} height={height} max={maxValue} ticks={scale.values} />
      {data.benchmark !== null && data.benchmark !== undefined && (
        <line
          x1={left}
          x2={left + plotW}
          y1={top + plotH - (data.benchmark / maxValue) * plotH}
          y2={top + plotH - (data.benchmark / maxValue) * plotH}
          stroke="#e879a8"
          strokeDasharray="5 4"
          strokeWidth="1.2"
        />
      )}
      {categories.map((category, ci) => {
        const center = left + band * ci + band / 2;
        let stackedBase = 0;
        return (
          <g key={`${category.label}-${ci}`}>
            {category.values.map((value, si) => {
              const h = maxValue === 0 ? 0 : (value / maxValue) * plotH;
              let x: number;
              let y: number;
              if (stacked) {
                x = center - barWidth / 2;
                y = top + plotH - stackedBase - h;
                stackedBase += h;
              } else if (multi) {
                x = center - barGroupWidth / 2 + si * (barWidth + 3);
                y = top + plotH - h;
              } else {
                x = center - barWidth / 2;
                y = top + plotH - h;
              }
              return (
                <g key={si}>
                  {chartType === "lollipop" ? (
                    <>
                      <line
                        x1={x + barWidth / 2}
                        x2={x + barWidth / 2}
                        y1={top + plotH}
                        y2={y}
                        stroke={COLORS[si % COLORS.length]}
                        strokeWidth="2"
                      />
                      <circle
                        cx={x + barWidth / 2}
                        cy={y}
                        r={4.5}
                        fill={COLORS[si % COLORS.length]}
                        stroke="#fff"
                        strokeWidth="1"
                      >
                        <title>{`${category.label} / ${data.series[si] ?? ""}: ${value}`}</title>
                      </circle>
                    </>
                  ) : (
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(0, h)}
                      rx={3}
                      fill={COLORS[si % COLORS.length]}
                      opacity={0.9}
                    >
                      <title>{`${category.label} / ${data.series[si] ?? ""}: ${value}`}</title>
                    </rect>
                  )}
                  {showLabels && value > 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="600"
                      fill="#6b6b6b"
                    >
                      {value}
                    </text>
                  )}
                </g>
              );
            })}
            <text
              x={center}
              y={top + plotH + 18}
              textAnchor={rotateLabels ? "end" : "middle"}
              fontSize="10"
              fill="#7d7d7d"
              transform={rotateLabels ? `rotate(-32 ${center} ${top + plotH + 18})` : undefined}
            >
              {truncate(category.label)}
              <title>{category.label}</title>
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}

function DonutChart({ data }: { data: DashboardWidgetData }) {
  const slices = data.categories
    .map((category) => ({ label: category.label, value: category.values[0] ?? 0 }))
    .filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <EmptyChart />;
  const radius = 68;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  const offsets = slices.map((_, index) =>
    slices.slice(0, index).reduce((sum, slice) => sum + (slice.value / total) * circumference, 0),
  );
  return (
    <div className="flex min-h-[250px] items-center gap-5 px-2">
      <svg viewBox="0 0 220 220" className="h-[190px] w-[190px] shrink-0">
        <circle cx="110" cy="110" r={radius} fill="none" stroke="#f0edff" strokeWidth={stroke} />
        {slices.map((slice, i) => {
          const length = (slice.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={slice.label}
              cx="110"
              cy="110"
              r={radius}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offsets[i]}
              transform="rotate(-90 110 110)"
              strokeLinecap="butt"
            >
              <title>{`${slice.label}: ${slice.value}`}</title>
            </circle>
          );
          return el;
        })}
        <text x="110" y="106" textAnchor="middle" fontSize="28" fontWeight="600" fill="#303030">
          {total}
        </text>
        <text x="110" y="126" textAnchor="middle" fontSize="11" fill="#8a8a8a">
          合計
        </text>
      </svg>
      <div className="min-w-0 space-y-2">
        {slices.map((slice, i) => (
          <div key={slice.label} className="flex items-center gap-2 text-[12px] text-neutral-600">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="truncate">{slice.label}</span>
            <span className="ml-auto font-medium text-neutral-800">{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeChart({ data }: { data: DashboardWidgetData }) {
  if (data.categories.length === 0) return <EmptyChart />;
  const width = 640;
  const height = 260;
  const left = 42;
  const right = 16;
  const top = 20;
  const bottom = 42;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const scale = niceTicks(
    Math.max(1, ...data.categories.flatMap((c) => c.values), data.benchmark ?? 0),
  );
  const maxValue = scale.max;
  const count = data.categories.length;
  const xAt = (index: number) => left + (count === 1 ? plotW / 2 : (index / (count - 1)) * plotW);
  const yAt = (value: number) => top + plotH - (value / maxValue) * plotH;
  const labelEvery = Math.max(1, Math.ceil(count / 7));
  return (
    <ChartFrame height={height}>
      <GridAndAxes width={width} height={height} max={maxValue} ticks={scale.values} />
      {data.benchmark !== null && data.benchmark !== undefined && (
        <line x1={left} x2={left + plotW} y1={yAt(data.benchmark)} y2={yAt(data.benchmark)} stroke="#e879a8" strokeDasharray="5 4" />
      )}
      {data.series.map((series, si) => {
        const points = data.categories.map((category, i) => `${xAt(i)},${yAt(category.values[si] ?? 0)}`);
        return (
          <g key={series}>
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke={COLORS[si % COLORS.length]}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {data.categories.map((category, i) => (
              <circle
                key={`${series}-${i}`}
                cx={xAt(i)}
                cy={yAt(category.values[si] ?? 0)}
                r="3.2"
                fill={COLORS[si % COLORS.length]}
                stroke="#fff"
                strokeWidth="1"
              >
                <title>{`${category.label} / ${series}: ${category.values[si] ?? 0}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {data.categories.map((category, i) => {
        if (i % labelEvery !== 0 && i !== count - 1) return null;
        return (
          <text
            key={`${category.label}-${i}`}
            x={xAt(i)}
            y={top + plotH + 18}
            textAnchor="middle"
            fontSize="9.5"
            fill="#8a8a8a"
          >
            {category.label}
          </text>
        );
      })}
      <g transform={`translate(${left}, ${height - 8})`}>
        {data.series.map((series, si) => (
          <g key={series} transform={`translate(${si * 92}, 0)`}>
            <rect width="8" height="8" y="-7" rx="2" fill={COLORS[si % COLORS.length]} />
            <text x="12" y="0" fontSize="10" fill="#777">
              {series}
            </text>
          </g>
        ))}
      </g>
    </ChartFrame>
  );
}

export default function ChartRenderer({
  data,
  chartType,
}: {
  data: DashboardWidgetData;
  chartType: DashboardChartType;
}) {
  if (data.kind === "disabled-status") {
    return (
      <div data-dashboard-status-disabled className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5">
        <div className="font-semibold text-neutral-800">Statusフィールドは削除されています</div>
        <p className="mt-1 text-sm text-neutral-500">
          カスタマイズ → フィールドからStatusを再追加すると、保持されている値が再表示されます。
        </p>
      </div>
    );
  }
  if (data.kind === "number") {
    return (
      <div className="flex min-h-[64px] flex-col items-center justify-center py-1">
        <div className="text-[48px] font-semibold leading-none tracking-tight text-neutral-900">
          {data.value ?? 0}
        </div>
      </div>
    );
  }
  if (chartType === "donut") return <DonutChart data={data} />;
  if (chartType === "line" || chartType === "burnup" || chartType === "burndown") {
    return <TimeChart data={data} />;
  }
  if (chartType === "number") return <EmptyChart />;
  return <CategoricalChart data={data} chartType={chartType} />;
}
