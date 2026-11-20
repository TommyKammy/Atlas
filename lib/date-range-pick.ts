/**
 * Start/due range picker intent. Asana keeps a "currently editing" endpoint:
 * a calendar click always fills that endpoint, then start editing moves to the
 * due field. Keeping this as a pure function makes the click rules testable
 * without the calendar DOM.
 */
export type DateRangeField = "start" | "due";

/** Due-only tasks start on the due field; new and ranged tasks start on start. */
export function initialDateRangeField(start: string, due: string): DateRangeField {
  return start === "" && due !== "" ? "due" : "start";
}

export type DateRangePick = {
  start: string;
  due: string;
  active: DateRangeField;
};

/**
 * Apply a calendar day to the active field and keep start <= due. Picking a
 * start day moves the cursor to due so the next click completes the range;
 * picking a due day keeps the cursor on due.
 */
export function pickDateRangeDay(
  active: DateRangeField,
  start: string,
  due: string,
  iso: string,
): DateRangePick {
  if (active === "start") {
    return {
      start: iso,
      due: due !== "" && iso > due ? iso : due,
      active: "due",
    };
  }
  return {
    start: start !== "" && iso < start ? iso : start,
    due: iso,
    active: "due",
  };
}
