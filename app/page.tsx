import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import HomeDashboard from "@/components/home/HomeDashboard";
import { getCurrentUserId } from "@/lib/current-user";
import { todayISO } from "@/lib/dates";
import { homeWeekCompletionSince } from "@/lib/home-summary";
import { getInboxPage, getUnreadCount, getUsers, getWorkspace } from "@/lib/data";
import { getHomeWaitingProposals } from "@/lib/planning/home-waiting";
import {
  getHomeAssignedTasks,
  getHomeCommentDrafts,
  getHomeForms,
  getHomeMembers,
  getHomeMentions,
  getHomeMyTasks,
  getHomePortfolio,
  getHomeProjects,
  getHomeStatusProjects,
  getHomeStatusUpdates,
  getHomeWeekCompletedCount,
  getHomeWidgets,
  getUserNotepad,
} from "@/lib/repositories/home";

export const instant = false;

export default async function Home() {
  const ws = await getWorkspace();
  if (!ws) {
    return (
      <div className="h-full overflow-auto p-8">
        <h1 className="text-xl font-bold">Atlas</h1>
        <p className="mt-2 text-secondary">
          ワークスペースがありません。DB初期化（db/init.sql + seed）を確認してください。
        </p>
      </div>
    );
  }
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");

  const today = todayISO();
  const [
    users,
    widgets,
    myTasks,
    assignedTasks,
    projects,
    members,
    portfolio,
    statusUpdates,
    statusProjects,
    forms,
    mentions,
    commentDrafts,
    notepad,
    unread,
    inbox,
    waitingProposals,
    weekCompleted,
  ] = await Promise.all([
    getUsers(uid),
    getHomeWidgets(ws.id, uid),
    getHomeMyTasks(uid),
    getHomeAssignedTasks(uid),
    getHomeProjects(ws.id, uid),
    getHomeMembers(ws.id, uid),
    getHomePortfolio(ws.id, uid),
    getHomeStatusUpdates(ws.id, uid),
    getHomeStatusProjects(ws.id, uid),
    getHomeForms(ws.id, uid),
    getHomeMentions(ws.id, uid),
    getHomeCommentDrafts(uid),
    getUserNotepad(uid),
    getUnreadCount(uid, ws.id),
    getInboxPage(uid, ws.id, { filter: "all", limit: 3 }),
    getHomeWaitingProposals(ws.id, uid),
    getHomeWeekCompletedCount(uid, homeWeekCompletionSince(today), today),
  ]);

  const me = users.find((user) => user.id === uid) ?? null;
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLine = `${now.getMonth() + 1}月 ${now.getDate()}日 ${weekdays[now.getDay()]}曜日`;

  return (
    <>
      <HomeDashboard
        canCreateProject={await hasPermission(uid, "projects.create")}
        userId={uid}
        userName={me?.name ?? ""}
        today={today}
        dateLine={dateLine}
        weekCompleted={weekCompleted}
        myTaskCount={myTasks.filter((task) => !task.completed).length}
        unreadCount={unread}
        widgets={widgets}
        myTasks={myTasks}
        assignedTasks={assignedTasks}
        projects={projects}
        members={members}
        portfolio={portfolio}
        statusUpdates={statusUpdates}
        statusProjects={statusProjects}
        forms={forms}
        mentions={mentions}
        commentDrafts={commentDrafts}
        notepad={notepad}
        users={users.map((user) => ({ id: user.id, name: user.name, avatar_url: user.avatar_url }))}
        waitingProposals={waitingProposals}
        inboxItems={inbox.items}
        now={now.toISOString()}
      />
    </>
  );
}
