"use client";

import { useState, type ReactNode } from "react";
import type { DashboardWidgetData } from "@/lib/dashboard-compute";
import type { DashboardChartType, DashboardDrilldown } from "@/lib/dashboard-types";

const COLORS = ["#9b8cff", "#37b97c", "#5b9cf8", "#f0a44b", "#e879a8"];
type HrefFor = (selection: DashboardDrilldown) => string;
type ChartProps = { data: DashboardWidgetData; title?: string; hrefFor?: HrefFor };

function datumLabel(title: string | undefined, category: string, series: string, value: number): string {
  return [title, category, series !== title ? series : "", String(value), "対象のタスクをリストで表示"]
    .filter(Boolean).join("、");
}

function SvgDatumLink({
  children, href, label, categoryKey, seriesIndex, kind = "cell",
}: {
  children: ReactNode;
  href?: string;
  label: string;
  categoryKey?: string;
  seriesIndex?: number;
  kind?: "cell" | "total";
}) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      aria-label={label}
      data-dashboard-chart-link={kind}
      data-dashboard-chart-category={categoryKey}
      data-dashboard-chart-series={seriesIndex}
      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8]"
    >
      {children}
    </a>
  );
}

/** A keyboard alternative for zero-height bars and coincident chart points. */
function ChartDataLinks({ data, title, hrefFor }: ChartProps) {
  const [open, setOpen] = useState(false);
  if (!hrefFor || data.categories.length === 0) return null;
  return (
    <details data-dashboard-chart-data onToggle={(event) => setOpen(event.currentTarget.open)} className="mt-1 text-[11px] text-neutral-600">
      <summary
        aria-label={`${title ?? "チャート"}のデータを表示`}
        className="w-fit cursor-pointer rounded px-1 py-1 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8]"
      >
        データを表示
      </summary>
      {open && (
        <div className="max-h-56 overflow-auto border-t border-neutral-100">
          <table className="w-full text-left text-[12px]">
            <caption className="sr-only">{title ?? "チャート"}の対象タスク</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-2 font-medium">分類</th>
                {data.series.map((series, index) => (
                  <th key={`${series}-${index}`} scope="col" className="px-2 py-2 text-right font-medium">{series}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.categories.map((category, categoryIndex) => (
                <tr key={category.key ?? categoryIndex} className="border-t border-neutral-100">
                  <th scope="row" className="px-2 py-1.5 font-normal">{category.label}</th>
                  {category.values.map((value, seriesIndex) => {
                    const selection = category.drilldowns?.[seriesIndex];
                    return (
                      <td key={seriesIndex} className="px-2 py-1.5 text-right tabular-nums">
                        {selection ? (
                          <a
                            href={hrefFor(selection)}
                            aria-label={datumLabel(title, category.label, data.series[seriesIndex] ?? "", value)}
                            data-dashboard-chart-link="table"
                            data-dashboard-chart-category={category.key}
                            data-dashboard-chart-series={seriesIndex}
                            className="inline-block rounded px-1 py-0.5 text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8]"
                          >
                            {value}
                          </a>
                        ) : value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

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
  title,
  interactive = false,
}: {
  children: ReactNode;
  height?: number;
  title?: string;
  interactive?: boolean;
}) {
  return (
    <svg
      viewBox={`0 0 640 ${height}`}
      role={interactive ? "group" : "img"}
      aria-label={title ?? "チャート"}
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

function CategoricalChart({ data, chartType, title, hrefFor }: ChartProps & { chartType: DashboardChartType }) {
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
  const stacked = chartType === "stacked_bar";
  const categoryMaximum = stacked
    ? Math.max(0, ...categories.map((category) => category.values.reduce((sum, value) => sum + value, 0)))
    : Math.max(0, ...categories.flatMap((category) => category.values));
  const scale = niceTicks(
    Math.max(1, categoryMaximum, data.benchmark ?? 0),
  );
  const maxValue = scale.max;
  const band = plotW / categories.length;
  const barGroupWidth = Math.min(76, band * 0.66);
  const barWidth = Math.max(3, barGroupWidth / seriesCount - 3);
  const rotateLabels = categories.length > 6;
  const showLabels = data.dataLabels && categories.length <= 12;
  const multi = seriesCount > 1;

  return (
    <ChartFrame height={height} title={title} interactive={Boolean(hrefFor)}>
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
          <g key={category.key ?? `${category.label}-${ci}`}>
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
              const selection = category.drilldowns?.[si];
              return (
                <g key={si}>
                  <SvgDatumLink
                    href={hrefFor && selection ? hrefFor(selection) : undefined}
                    label={datumLabel(title, category.label, data.series[si] ?? "", value)}
                    categoryKey={category.key}
                    seriesIndex={si}
                  >
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
                      {hrefFor && selection && (
                        <circle cx={x + barWidth / 2} cy={y} r="9" fill="transparent" />
                      )}
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
                  </SvgDatumLink>
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

function DonutChart({ data, title, hrefFor }: ChartProps) {
  const slices = data.categories
    .map((category, categoryIndex) => ({ category, categoryIndex, label: category.label, value: category.values[0] ?? 0 }))
    .filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <EmptyChart />;
  const radius = 68;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  const offsets: number[] = [];
  let offset = 0;
  for (const slice of slices) {
    offsets.push(offset);
    offset += (slice.value / total) * circumference;
  }
  return (
    <div className="flex min-h-[250px] items-center gap-5 px-2">
      <svg viewBox="0 0 220 220" role={hrefFor ? "group" : "img"} aria-label={title ?? "チャート"} className="h-[190px] w-[190px] shrink-0">
        <circle cx="110" cy="110" r={radius} fill="none" stroke="#f0edff" strokeWidth={stroke} />
        {slices.map((slice, i) => {
          const length = (slice.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const selection = slice.category.drilldowns?.[0];
          const el = (
            <SvgDatumLink
              key={slice.category.key ?? slice.categoryIndex}
              href={hrefFor && selection ? hrefFor(selection) : undefined}
              label={datumLabel(title, slice.label, data.series[0] ?? "", slice.value)}
              categoryKey={slice.category.key}
              seriesIndex={0}
            >
            <circle
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
            </SvgDatumLink>
          );
          return el;
        })}
        <SvgDatumLink
          href={hrefFor && data.drilldown ? hrefFor(data.drilldown) : undefined}
          label={datumLabel(title, "合計", "", total)}
          kind="total"
        >
        <text x="110" y="106" textAnchor="middle" fontSize="28" fontWeight="600" fill="#303030">
          {total}
        </text>
        <text x="110" y="126" textAnchor="middle" fontSize="11" fill="#8a8a8a">
          合計
        </text>
        </SvgDatumLink>
      </svg>
      <div className="min-w-0 space-y-2">
        {slices.map((slice, i) => {
          const selection = slice.category.drilldowns?.[0];
          const href = hrefFor && selection ? hrefFor(selection) : undefined;
          const content = <>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="truncate">{slice.label}</span>
            <span className="ml-auto font-medium text-neutral-800">{slice.value}</span>
          </>;
          return href ? (
            <a
              key={slice.category.key ?? slice.categoryIndex}
              href={href}
              aria-label={datumLabel(title, slice.label, data.series[0] ?? "", slice.value)}
              data-dashboard-chart-link="legend"
              data-dashboard-chart-category={slice.category.key}
              data-dashboard-chart-series={0}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] text-neutral-600 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c60b8]"
            >{content}</a>
          ) : <div key={slice.category.key ?? slice.categoryIndex} className="flex items-center gap-2 text-[12px] text-neutral-600">{content}</div>;
        })}
      </div>
    </div>
  );
}

function TimeChart({ data, title, hrefFor }: ChartProps) {
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
    <ChartFrame height={height} title={title} interactive={Boolean(hrefFor)}>
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
            {data.categories.map((category, i) => {
              const selection = category.drilldowns?.[si];
              return (
              <SvgDatumLink
                key={`${category.key ?? i}-${si}`}
                href={hrefFor && selection ? hrefFor(selection) : undefined}
                label={datumLabel(title, category.label, series, category.values[si] ?? 0)}
                categoryKey={category.key}
                seriesIndex={si}
              >
              <circle
                cx={xAt(i)}
                cy={yAt(category.values[si] ?? 0)}
                r="3.2"
                fill={COLORS[si % COLORS.length]}
                stroke="#fff"
                strokeWidth="1"
              >
                <title>{`${category.label} / ${series}: ${category.values[si] ?? 0}`}</title>
              </circle>
              {hrefFor && selection && (
                <circle
                  cx={xAt(i)}
                  cy={yAt(category.values[si] ?? 0)}
                  r={Math.min(8, Math.max(3.2, plotW / Math.max(1, count - 1) / 2))}
                  fill="transparent"
                />
              )}
              </SvgDatumLink>
              );
            })}
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
  title,
  hrefFor,
}: {
  data: DashboardWidgetData;
  chartType: DashboardChartType;
  title?: string;
  hrefFor?: HrefFor;
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
    const href = hrefFor && data.drilldown ? hrefFor(data.drilldown) : undefined;
    const value = data.value ?? 0;
    const valueClass = "text-[48px] font-semibold leading-none tracking-tight text-neutral-900";
    return (
      <div className="flex min-h-[64px] flex-col items-center justify-center py-1">
        {href ? (
          <a href={href} aria-label={datumLabel(title, "", "", value)} data-dashboard-chart-link="total" className={`${valueClass} rounded hover:underline hover:decoration-neutral-300 hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2c60b8]`}>
            {value}
          </a>
        ) : <div className={valueClass}>{value}</div>}
      </div>
    );
  }
  if (data.kind === "text") return null;
  let chart: ReactNode;
  if (chartType === "donut") chart = <DonutChart data={data} title={title} hrefFor={hrefFor} />;
  else if (chartType === "line" || chartType === "burnup" || chartType === "burndown") {
    chart = <TimeChart data={data} title={title} hrefFor={hrefFor} />;
  }
  else if (chartType === "number") chart = <EmptyChart />;
  else chart = <CategoricalChart data={data} chartType={chartType} title={title} hrefFor={hrefFor} />;
  return <div>{chart}<ChartDataLinks data={data} title={title} hrefFor={hrefFor} /></div>;
}
