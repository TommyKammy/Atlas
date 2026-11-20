import { listSummaryText, type ListTaskSummary } from "@/lib/list-row-state";

/** One quiet line above the list: total, completed and overdue counts. */
export default function ListSummaryLine({ summary }: { summary: ListTaskSummary }) {
  return (
    <div
      data-list-summary
      className="flex h-8 items-center px-2 text-[12px] whitespace-nowrap text-muted"
    >
      {listSummaryText(summary)}
    </div>
  );
}
