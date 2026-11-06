export function dayDeltaFromPixels(dxPx: number, contentWidthPx: number, spanDays: number): number {
  if (!Number.isFinite(dxPx) || !Number.isFinite(contentWidthPx) || contentWidthPx <= 0 || spanDays <= 0) {
    return 0;
  }
  return Math.round((dxPx / contentWidthPx) * spanDays);
}

export function shiftDate(isoDate: string, deltaDays: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`invalid date: ${isoDate}`);
  return new Date(t + deltaDays * 86400000).toISOString().slice(0, 10);
}
