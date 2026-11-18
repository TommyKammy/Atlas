import { notFound, redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { getProject, getProjectAccess, getProjectTasks, getSections } from "@/lib/data";
import PrintButton from "@/components/project/PrintButton";

export const instant = false;

export default async function ProjectPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");
  const access = await getProjectAccess(viewerId, projectId);
  if (!access.role) notFound();
  const project = await getProject(projectId);
  if (!project || project.deleted_at) notFound();
  const [sections, tasks] = await Promise.all([getSections(projectId), getProjectTasks(projectId)]);
  const topLevel = tasks.filter((task) => task.parent_task_id === null);
  const sectionIds = new Set(sections.map((section) => Number(section.id)));
  const unclassified = topLevel.filter(
    (task) => task.section_id === null || !sectionIds.has(Number(task.section_id)),
  );
  const printSections = unclassified.length > 0
    ? [...sections, { id: 0, name: "未分類", position: Number.MAX_SAFE_INTEGER }]
    : sections;

  return (
    <div data-print-view className="mx-auto max-w-5xl bg-surface p-8 text-neutral-900 print:p-0">
      <div className="flex items-start justify-between print:hidden">
        <p className="text-xs text-subtle">Atlas 印刷ビュー</p>
        <PrintButton />
      </div>
      <h1 className="mt-2 text-2xl font-bold">{project.name}</h1>
      {project.description && <p className="mt-1 text-sm text-secondary">{project.description}</p>}
      <p className="mt-1 text-xs text-muted">
        {topLevel.filter((t) => t.completed).length}/{topLevel.length} 完了 ・ 印刷日 {new Date().toLocaleDateString("ja-JP")}
      </p>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted">
            <th className="py-1.5 pr-3 font-medium">タスク</th>
            <th className="w-28 py-1.5 pr-3 font-medium">担当者</th>
            <th className="w-24 py-1.5 pr-3 font-medium">期日</th>
            <th className="w-20 py-1.5 font-medium">進捗</th>
          </tr>
        </thead>
        <tbody>
          {printSections.map((section) => {
            const sectionTasks = section.id === 0
              ? unclassified
              : topLevel.filter((task) => task.section_id === section.id);
            return (
              <tr key={section.id} className="align-top">
                <td colSpan={4} className="pt-4">
                  <div className="border-b pb-1 text-xs font-semibold text-muted">{section.name}</div>
                  {sectionTasks.length === 0 && <div className="py-1 text-xs text-subtle">タスクなし</div>}
                  {sectionTasks.map((task) => (
                    <div
                      key={task.id}
                      className="grid grid-cols-[minmax(0,1fr)_112px_96px_80px] gap-2 border-b border-neutral-100 py-1.5"
                    >
                      <span className={task.completed ? "text-subtle line-through" : ""}>{task.name}</span>
                      <span className="truncate text-xs text-secondary">{task.assignee_name ?? "—"}</span>
                      <span className="text-xs text-secondary">{task.due_on ?? "—"}</span>
                      <span className="text-xs text-secondary">{task.progress}%</span>
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
