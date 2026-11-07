/** Pure recurrence date arithmetic shared by single and bulk task completion. */
export function nextOccurrence(iso: string | null, recurrence: string): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (recurrence === "daily") {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (recurrence === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    // Jan 31 -> Feb 28/29, Mar 31 -> Apr 30, etc.
    if (d.getUTCDate() < day) d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}
