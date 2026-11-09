import { redirect } from "next/navigation";
import HomeDashboard from "@/components/home/HomeDashboard";
import ProjectTemplateBar from "@/components/ProjectTemplateBar";
import { getCurrentUserId } from "@/lib/current-user";
import { todayISO } from "@/lib/dates";
import {
  getProjectTemplateList,
  getProjectsForUser,
  getUnreadCount,
  getUsers,
  getWorkspace,
} from "@/lib/data";
import {
  getHomeAssignedTasks,
  getHomeMembers,
  getHomeMyTasks,
  getHomeProjects,
  getHomeWidgets,
} from "@/lib/repositories/home";

export const instant = false;

export default async function Home() {
  const ws = await getWorkspace();
  if (!ws) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold">Atlas</h1>
        <p className="mt-2 text-neutral-600">
          ワークスペースがありません。DB初期化（db/init.sql + seed）を確認してください。
        </p>
      </div>
    );
  }
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");

  const [users, widgets, myTasks, assignedTasks, projects, members, unread, templates, projectList] =
    await Promise.all([
      getUsers(),
      getHomeWidgets(ws.id, uid),
      getHomeMyTasks(uid),
      getHomeAssignedTasks(uid),
      getHomeProjects(ws.id, uid),
      getHomeMembers(ws.id, uid),
      getUnreadCount(uid, ws.id),
      getProjectTemplateList(ws.id),
      getProjectsForUser(ws.id, uid),
    ]);

  const me = users.find((user) => user.id === uid) ?? null;
  const today = todayISO();
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 11 ? "おはようございます" : hour < 18 ? "こんにちは" : "こんばんは";
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLine = `${now.getMonth() + 1}月 ${now.getDate()}日 ${weekdays[now.getDay()]}曜日`;

  return (
    <>
      <HomeDashboard
        workspaceId={ws.id}
        userId={uid}
        today={today}
        dateLine={dateLine}
        greeting={`${me?.name ?? ""} さん、${greet}`}
        myTaskCount={myTasks.filter((task) => !task.completed).length}
        unreadCount={unread}
        widgets={widgets}
        myTasks={myTasks}
        assignedTasks={assignedTasks}
        projects={projects}
        members={members}
        users={users.map((user) => ({ id: user.id, name: user.name, avatar_url: user.avatar_url }))}
      />
      <div className="px-6">
        <ProjectTemplateBar workspaceId={ws.id} projects={projectList} initial={templates} />
      </div>
    </>
  );
}
