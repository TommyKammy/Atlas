export function dayDeltaFromPixels(dxPx: number, contentWidthPx: number, spanDays: number): number {
  if (!Number.isFinite(dxPx) || !Number.isFinite(contentWidthPx) || contentWidthPx <= 0 || spanDays <= 0) {
    return 0;
  }
  return Math.round((dxPx / contentWidthPx) * spanDays);
}

import { shiftDay } from "./calendar";

export function shiftDate(isoDate: string, deltaDays: number): string {
  return shiftDay(isoDate, deltaDays);
}
