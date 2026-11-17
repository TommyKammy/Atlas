import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import ProjectCreateScreen from "@/components/project-create/ProjectCreateScreen";
import { getCurrentUserId } from "@/lib/current-user";
import { getUsers, getWorkspace } from "@/lib/data";
import { getProjectTemplateSummaries } from "@/lib/repositories/projects";

export const instant = false;

export default async function NewProjectPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  if (!(await hasPermission(uid, "projects.create"))) redirect("/");
  const ws = await getWorkspace();
  if (!ws) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">プロジェクトを作成</h1>
        <p className="mt-2 text-neutral-600">
          ワークスペースがありません。DB初期化（db/init.sql + seed）を確認してください。
        </p>
      </div>
    );
  }

  const [templates, users] = await Promise.all([
    getProjectTemplateSummaries(ws.id),
    getUsers(uid),
  ]);
  const me = users.find((user) => user.id === uid) ?? null;

  return (
    <ProjectCreateScreen
      workspaceId={ws.id}
      workspaceName={ws.name}
      viewerId={uid}
      isWorkspaceAdmin={me?.is_admin === true}
      templates={templates}
    />
  );
}
