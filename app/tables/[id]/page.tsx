import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import { getProjectAccess } from "@/lib/data";

export const instant = false;

type TableRow = {
  id: number;
  project_id: number;
  project_name: string;
  name: string;
  columns: { key: string; label: string; type: string }[];
  rows: unknown[][];
  created_at: string;
};

export default async function ProjectTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tableId = Number(id);
  if (!Number.isInteger(tableId)) notFound();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");
  const result = await db.query(
    `SELECT t.id, t.project_id, p.name AS project_name, t.name, t.columns, t.rows,
       t.created_at::text AS created_at
     FROM project_tables t JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1::bigint AND p.deleted_at IS NULL`,
    [tableId],
  );
  const table = result.rows[0] as TableRow | undefined;
  if (!table) notFound();
  const access = await getProjectAccess(viewerId, Number(table.project_id));
  if (!access.role) notFound();

  return (
    <div className="p-6">
      <p className="text-xs text-subtle">
        {table.project_name} から作成したテーブル ・ {table.created_at.slice(0, 10)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{table.name}</h1>
        <a
          href={`/api/tables/${table.id}/export?format=csv`}
          className="text-sm text-accent-text hover:underline"
        >
          CSV
        </a>
        <a
          href={`/api/tables/${table.id}/export?format=xlsx`}
          className="text-sm text-accent-text hover:underline"
        >
          XLSX
        </a>
        <a href={`/projects/${table.project_id}?view=list`} className="text-sm text-muted hover:underline">
          元のプロジェクト →
        </a>
      </div>
      <div className="mt-4 overflow-auto rounded border">
        <table className="min-w-full border-collapse text-sm" data-project-table={table.id}>
          <thead className="sticky top-0 bg-surface-subtle">
            <tr>
              {table.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap border-b px-3 py-2 text-left font-semibold text-secondary">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, table.columns.length)} className="px-3 py-6 text-center text-subtle">
                  行がありません
                </td>
              </tr>
            )}
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white even:bg-surface-subtle/50">
                {table.columns.map((column, columnIndex) => (
                  <td key={column.key} className="whitespace-nowrap border-b border-line-subtle px-3 py-1.5">
                    {String(row[columnIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">{table.rows.length}行</p>
    </div>
  );
}
