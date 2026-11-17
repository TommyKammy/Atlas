import type { ReactNode } from "react";
import "./planning.css";

const tableClasses = {
  region: "ppt-region",
  table: "ppt-table",
  stack: "ppt-stack",
  matrix: "ppt-matrix",
  numeric: "ppt-numeric",
  cellButton: "ppt-cell-button",
  meter: "ppt-meter",
  meterHot: "ppt-meter-hot",
} as const;

/**
 * Semantic table inside a focusable, labelled scroll region. The stacked
 * variant keeps the header/row relationships through data-label attributes.
 */
export default function PlanningTable({
  label,
  caption,
  children,
  stacked = false,
  matrix = false,
  className = "",
}: {
  label: string;
  caption: string;
  children: ReactNode;
  stacked?: boolean;
  matrix?: boolean;
  className?: string;
}) {
  return (
    <div className={`${tableClasses.region} ${className}`} role="region" aria-label={label} tabIndex={0}>
      <table className={`${tableClasses.table} ${stacked ? tableClasses.stack : ""} ${matrix ? tableClasses.matrix : ""}`}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export { tableClasses as planningTableStyles };
