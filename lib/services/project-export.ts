import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/api/errors";
import { csvResponse, toCsv } from "@/lib/csv";
import { buildXlsx } from "@/lib/xlsx";
import { shiftDate } from "@/lib/timeline-dnd";
import { taskCustomValuePairs, type TaskCustomValuePairs } from "@/lib/repositories/task-custom-value-pairs";
import { projectTaskReadScope } from "@/lib/repositories/scope";

type ExportTask = {
  id: number;
  section_id: number | null;
  parent_task_id: number | null;
  name: string;
  description: string;
  assignee: string | null;
  completed: boolean;
  start_on: string | null;
  due_on: string | null;
  progress: number;
  status: string;
  recurrence: string;
  comments: string | null;
  custom_values: TaskCustomValuePairs;
};

type ExportField = {
  id: number;
  name: string;
  field_type: string;
};

function safeFilename(name: string): string {
  return name.replace(/[^\w\-ぁ-んァ-ン一-龯ー]+/g, "_").slice(0, 80) || "project";
}

function icalEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icalDate(iso: string): string {
  return iso.replace(/-/g, "");
}

/** Export a project as CSV or XLSX using the importer's column dialect. */
export async function exportProject(
  req: Request,
  { projectId }: { projectId: number },
): Promise<Response> {

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "json";
  if (!["json", "csv", "xlsx", "timecsv", "ical"].includes(format)) {
    throw badRequest("format must be json, csv, xlsx, timecsv or ical");
  }
  const p = await db.query("SELECT id, name, description FROM projects WHERE id = $1::bigint", [projectId]);
  const project = p.rows[0] as { id: number; name: string; description: string | null };

  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1::bigint ORDER BY position, id",
    [projectId],
  );
  const fields = await db.query(
    `SELECT id, name, field_type, options, description, config, position
     FROM custom_fields WHERE project_id = $1::bigint AND deleted_at IS NULL ORDER BY position, id`,
    [projectId],
  );
  const tasks = await db.query(
    `SELECT t.id,
       CASE WHEN t.project_id = $1 THEN t.section_id
         WHEN m.task_id IS NOT NULL THEN m.section_id
         WHEN parent.project_id = $1 THEN parent.section_id
         ELSE parent_membership.section_id END AS section_id,
       t.parent_task_id, t.name, t.description, u.name AS assignee,
       t.completed, t.start_on::text AS start_on, t.due_on::text AS due_on,
       t.progress, t.status, t.recurrence,
       (SELECT string_agg(c.body, E'\\n---\\n' ORDER BY c.id) FROM comments c WHERE c.task_id = t.id) AS comments,
       ${taskCustomValuePairs("$1")}
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN task_project_memberships m ON m.task_id = t.id AND m.project_id = $1 AND t.project_id IS DISTINCT FROM m.project_id
     LEFT JOIN tasks parent ON parent.id = t.parent_task_id AND parent.deleted_at IS NULL
     LEFT JOIN task_project_memberships parent_membership
       ON parent_membership.task_id = parent.id AND parent_membership.project_id = $1
     WHERE ${projectTaskReadScope("t")} AND t.deleted_at IS NULL
     ORDER BY COALESCE(m.position, t.position), t.id`,
    [projectId],
  );

  const fieldRows = fields.rows as ExportField[];
  const taskRows = tasks.rows as ExportTask[];
  const filename = safeFilename(project.name);

  if (format === "json") {
    const body = JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        project,
        sections: sections.rows,
        custom_fields: fields.rows,
        tasks: taskRows.map((task) => ({
          ...task,
          // Keep the legacy JSON field for existing consumers and expose the
          // unambiguous values separately.
          custom_values: task.custom_values?.map(([id, value]) => `${id}=${value}`).join(";") ?? null,
          custom_values_by_field: Object.fromEntries(task.custom_values ?? []),
        })),
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.json`)}`,
      },
    });
  }

  if (format === "ical") {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Atlas//Project Export//JA",
      "CALSCALE:GREGORIAN",
      `X-WR-CALNAME:${icalEscape(project.name)}`,
    ];
    for (const task of taskRows) {
      const date = task.due_on ?? task.start_on;
      if (!date) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:atlas-task-${task.id}@atlas.local`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `DTSTART;VALUE=DATE:${icalDate(date)}`,
        `DTEND;VALUE=DATE:${icalDate(shiftDate(date, 1))}`,
        `SUMMARY:${icalEscape(task.name)}`,
        `DESCRIPTION:${icalEscape(task.description ?? "")}`,
        `STATUS:${task.completed ? "COMPLETED" : "CONFIRMED"}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return new NextResponse(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.ics`)}`,
      },
    });
  }

  const sectionName = new Map((sections.rows as { id: number; name: string }[]).map((s) => [s.id, s.name]));

  if (format === "timecsv") {
    const timerFields = fieldRows.filter(
      (field) => field.field_type === "timer" || field.field_type === "time_tracking",
    );
    const header = ["セクション", "種別", "名前", "担当者", "期日", "合計（時間）", ...timerFields.map((f) => `${f.name}（秒）`)];
    const rows: unknown[][] = [header];
    for (const task of taskRows) {
      const customs = new Map(task.custom_values ?? []);
      const seconds = timerFields.reduce((sum, field) => sum + (Number(customs.get(String(field.id)) ?? 0) || 0), 0);
      rows.push([
        task.section_id === null ? "" : (sectionName.get(task.section_id) ?? ""),
        task.parent_task_id === null ? "タスク" : "サブタスク",
        task.name,
        task.assignee ?? "",
        task.due_on ?? "",
        (seconds / 3600).toFixed(2),
        ...timerFields.map((field) => customs.get(String(field.id)) ?? "0"),
      ]);
    }
    return csvResponse(`${filename}_time.csv`, toCsv(rows));
  }

  const header = [
    "セクション",
    "種別",
    "名前",
    "完了",
    "担当者",
    "開始日",
    "期日",
    "進捗",
    "Status",
    "繰返し",
    "コメント",
    ...fieldRows.map((f) => f.name),
  ];
  const rows: unknown[][] = [header];
  for (const task of taskRows) {
    const customs = new Map(task.custom_values ?? []);
    rows.push([
      task.section_id === null ? "" : (sectionName.get(task.section_id) ?? ""),
      task.parent_task_id === null ? "タスク" : "サブタスク",
      task.name,
      task.completed ? "完了" : "未完了",
      task.assignee ?? "",
      task.start_on ?? "",
      task.due_on ?? "",
      task.progress,
      task.status,
      task.recurrence === "none" ? "" : task.recurrence,
      task.comments ?? "",
      ...fieldRows.map((field) => customs.get(String(field.id)) ?? ""),
    ]);
  }

  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(buildXlsx(rows, project.name)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.xlsx`)}`,
      },
    });
  }

  return csvResponse(`${filename}.csv`, toCsv(rows));
}
