/** Label every point for short series; for 14-day series show at most five dates. */
export function shouldLabelUsagePoint(index: number, total: number): boolean {
  if (total <= 7) return true;
  const step = Math.ceil(total / 5);
  return index % step === 0;
}

/** The visible date and value labels are sampled; every point keeps its title/aria-label. */
export function usageDayLabel(day: string, index: number, total: number): string {
  return shouldLabelUsagePoint(index, total) ? day.slice(5) : "";
}

export function usageValueLabel(value: number, index: number, total: number): string {
  return value > 0 && shouldLabelUsagePoint(index, total) ? String(value) : "";
}
