import { getMyTasks, getUsers } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import MyTasksView from "@/components/MyTasksView";

export const instant = false;

export default async function MyTasksPage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  const tasks = me ? await getMyTasks(me.id) : [];
  const today = todayISO();

  return <MyTasksView tasks={tasks} today={today} viewerName={me?.name ?? "–"} />;
}
