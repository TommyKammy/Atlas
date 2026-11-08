import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { getProjectAccess } from "@/lib/data";
import { csvResponse, toCsv } from "@/lib/csv";
import { buildXlsx } from "@/lib/xlsx";

/** Download a project table snapshot as CSV or XLSX. */
export const GET = withUser(async (req, { uid, params }) => {
  const tableId = Number((params as { id?: string }).id);
  if (!Number.isInteger(tableId)) {
    return NextResponse.json({ error: "invalid table id" }, { status: 400 });
  }
  const result = await db.query(
    `SELECT t.project_id, t.name, t.columns, t.rows
     FROM project_tables t JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1::bigint AND p.deleted_at IS NULL`,
    [tableId],
  );
  if (result.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const access = await getProjectAccess(uid, Number(result.rows[0].project_id));
  if (!access.role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const columns = result.rows[0].columns as { key: string; label: string }[];
  const rows = result.rows[0].rows as unknown[][];
  const matrix = [columns.map((column) => column.label), ...rows];
  const filename = String(result.rows[0].name).replace(/[^\w\-ぁ-んァ-ン一-龯ー]+/g, "_").slice(0, 80) || "table";
  const format = new URL(req.url).searchParams.get("format") ?? "csv";
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(buildXlsx(matrix, result.rows[0].name)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.xlsx`)}`,
      },
    });
  }
  if (format !== "csv") return NextResponse.json({ error: "format must be csv or xlsx" }, { status: 400 });
  return csvResponse(`${filename}.csv`, toCsv(matrix));
});
