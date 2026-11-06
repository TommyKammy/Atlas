import { notFound } from "next/navigation";
import {
  getComments,
  getTaskEvents,
  getProjectStats,
  getDependencies,
  getProject,
  getCustomFields,
  getProjectAttachments,
  getTaskAttachments,
  getProjectMembers,
  getProjectAccess,
  getCommentReactions,
  getDashboardPrefs,
  getSubtasksBulk,
  getProjectMessages,
  touchRecentProject,
  isFavorite,
  getDashboardExtras,
  getTaskDependencies,
  getProjectTaskOptions,
  getSavedView,
  getSavedViews,
  getTaskCustomValues,
  getProjectTasks,
  getSections,
  getSubtasks,
  getTask,
  getTaskProjects,
  getUsers,
} from "@/lib/data";
import ProjectTabs from "@/components/ProjectTabs";
import ProjectIcon from "@/components/ProjectIcon";
import ListView from "@/components/ListView";
import BoardView from "@/components/BoardView";
import TimelineView from "@/components/TimelineView";
import CalendarView from "@/components/CalendarView";
import DashboardView from "@/components/DashboardView";
import FilesView from "@/components/FilesView";
import MessagesView from "@/components/MessagesView";
import OverviewView from "@/components/OverviewView";
import Shortcuts from "@/components/Shortcuts";
import StarButton from "@/components/StarButton";
import UserAvatar from "@/components/UserAvatar";
import ProjectShareButton from "@/components/ProjectShareButton";
import ProjectCustomizeButton from "@/components/ProjectCustomizeButton";
import TaskPane from "@/components/TaskPane";
import { getCurrentUserId } from "@/lib/current-user";

export const instant = false;

const VIEWS = new Set(["overview", "dashboard", "list", "board", "timeline", "calendar", "messages", "files"]);

export default async function ProjectPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const projectId = Number(params.id);
  if (!Number.isInteger(projectId)) notFound();

  const project = await getProject(projectId);
  if (!project) notFound();

  const view = typeof searchParams.view === "string" && VIEWS.has(searchParams.view)
    ? searchParams.view
    : "list";
  const taskId =
    typeof searchParams.task === "string" && /^\d+$/.test(searchParams.task)
      ? Number(searchParams.task)
      : null;
  const month =
    typeof searchParams.month === "string" && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : new Date().toISOString().slice(0, 7);
  const zoomRaw = typeof searchParams.zoom === "string" ? searchParams.zoom : "";
  const weekRaw = typeof searchParams.week === "string" ? searchParams.week : "";
  const week =
    zoomRaw === "week" && /^\d{4}-\d{2}-\d{2}$/.test(weekRaw) && !Number.isNaN(Date.parse(weekRaw))
      ? weekRaw
      : null;
  const savedId =
    typeof searchParams.saved === "string" && /^\d+$/.test(searchParams.saved)
      ? Number(searchParams.saved)
      : null;
  const qstr = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : "");
  const sortRaw = qstr("sort");
  const sortParam = (sortRaw === "due" || sortRaw === "name" || sortRaw === "progress" ? sortRaw : "position") as
    | "position"
    | "due"
    | "name"
    | "progress";
  const sortDirParam = qstr("sortdir") === "desc" ? "desc" : "asc";
  const dueParam = ["overdue", "today", "week", "nextweek", "month"].includes(qstr("due"))
    ? qstr("due")
    : "";
  const fromRaw = qstr("from");
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && !Number.isNaN(Date.parse(fromRaw))
    ? Math.floor(Date.parse(fromRaw) / 86400000)
    : null;
  const groupRaw = qstr("group");
  const boardGroup = (groupRaw === "assignee" || groupRaw === "status" ? groupRaw : "section") as
    | "section"
    | "assignee"
    | "status";
  const daysRaw = typeof searchParams.days === "string" ? Number(searchParams.days) : NaN;
  const days = [7, 14, 30].includes(daysRaw) ? daysRaw : 14;
  const calendarAssignee = /^\d+$/.test(qstr("assignee")) ? qstr("assignee") : qstr("assignee") === "none" ? "none" : "";
  const calendarCompleted = qstr("completed") === "open" || qstr("completed") === "done"
    ? qstr("completed")
    : qstr("hide") === "1"
      ? "open"
      : "";
  const calendarCustom: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key.startsWith("cf_") && typeof value === "string" && value) {
      calendarCustom[key.slice(3)] = value;
    }
  }

  const viewerId = await getCurrentUserId();
  if (!viewerId) notFound();
  const access = await getProjectAccess(viewerId, projectId);
  if (!access.role) notFound();
  const [sections, tasks, users, members, stats, messages, customFields, customValues, projectAttachments, savedViews, extras, deps, subtaskMap, prefs] =
    await Promise.all([
      getSections(projectId),
      getProjectTasks(projectId),
      getUsers(),
      getProjectMembers(projectId),
      getProjectStats(projectId),
      getProjectMessages(projectId),
      getCustomFields(projectId),
      getTaskCustomValues(projectId),
      getProjectAttachments(projectId),
      getSavedViews(projectId),
      getDashboardExtras(projectId, days),
      getTaskDependencies(projectId),
      getSubtasksBulk(projectId),
      getDashboardPrefs(viewerId, projectId),
    ]);

  const savedView = savedId ? await getSavedView(savedId) : undefined;
  const activeSaved =
    savedView && savedView.project_id === projectId && savedView.view_type === "list" ? savedView : undefined;

  const task = taskId ? await getTask(taskId) : undefined;
  await touchRecentProject(viewerId, projectId);
  const [subtasks, comments, memberships, dependencies, taskOptions, taskAttachments, reactions, taskEvents] = task
    ? await Promise.all([
        getSubtasks(task.id),
        getComments(task.id),
        getTaskProjects(task.id),
        getDependencies(task.id),
        getProjectTaskOptions(projectId),
        getTaskAttachments(task.id),
        getCommentReactions(task.id, viewerId),
        getTaskEvents(task.id),
      ])
    : [[], [], [], [], [], [], {}, []];

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 px-6 pt-3">
          <ProjectIcon
            id={project.id}
            name={project.name}
            color={project.color}
            icon={project.icon}
            className="h-7 w-7 text-sm"
          />
          <h1 className="text-[20px] leading-7 font-medium">{project.name}</h1>
          <StarButton projectId={projectId} initial={await isFavorite(viewerId, projectId)} />
          <a
            href={`/projects/${projectId}?view=overview`}
            className="ml-1 hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 md:flex"
          >
            <span className="h-3 w-3 rounded-full border-2 border-neutral-400" /> ステータスを設定
          </a>
          <span className="flex-1" />
          <span className="-space-x-1">
            {members.slice(0, 5).map((m) => (
              <span key={m.id} className="inline-block rounded-full border-2 border-white">
                <UserAvatar name={m.name} url={m.avatar_url} className="h-7 w-7" />
              </span>
            ))}
          </span>
          <ProjectShareButton projectId={projectId} projectName={project.name} />
          <ProjectCustomizeButton
            projectId={projectId}
            projectName={project.name}
            initialColor={project.color ?? null}
            initialIcon={project.icon ?? null}
            initialStatusOptions={project.status_options ?? []}
            initialFields={customFields}
            sections={sections}
            users={users}
            role={access.role}
          />
        </div>
        <ProjectTabs projectId={projectId} active={view} />
        {view === "overview" && (
          <OverviewView
            projectId={projectId}
            stats={stats}
            members={members.map((m) => ({ id: m.id, name: m.name, role: m.role ?? null }))}
            projectStatus={project.status}
          />
        )}
        {view === "dashboard" && <DashboardView projectId={projectId} stats={stats} extras={extras} days={days} prefs={prefs} />}
        {view === "list" && (
          <ListView
            projectId={projectId}
            sections={sections}
            tasks={tasks}
            users={users}
            customFields={customFields}
            customValues={customValues}
            savedViews={savedViews}
            subtaskMap={subtaskMap}
            activeSavedId={activeSaved?.id ?? null}
            projectStatusOptions={project.status_options ?? []}
            activeTaskId={taskId}
            initial={{
              hide_completed: activeSaved ? activeSaved.filters.hide_completed : qstr("hide") === "1",
              assignee: activeSaved ? (activeSaved.filters.assignee ?? "") : qstr("assignee"),
              status: activeSaved ? (activeSaved.filters.status ?? "") : qstr("status"),
              due: activeSaved ? (activeSaved.filters.due ?? "") : dueParam,
              sort: activeSaved?.sort_key ?? sortParam,
              sortdir: sortDirParam,
              group: activeSaved?.group_by ?? boardGroup,
            }}
          />
        )}
        {view === "board" && (
          <BoardView
            projectId={projectId}
            sections={sections}
            tasks={tasks}
            users={users}
            initialGroup={boardGroup}
          />
        )}
        {view === "timeline" && (
          <TimelineView
            projectId={projectId}
            sections={sections}
            tasks={tasks}
            deps={deps}
            startOverride={fromDay}
          />
        )}
        {view === "messages" && <MessagesView projectId={projectId} initial={messages} />}
        {view === "files" && <FilesView projectId={projectId} attachments={projectAttachments} />}
        {view === "calendar" && (
          <CalendarView
            projectId={projectId}
            tasks={tasks}
            sections={sections}
            users={users}
            customFields={customFields}
            customValues={customValues}
            projectStatusOptions={project.status_options ?? []}
            viewerId={viewerId}
            month={month}
            week={week}
            initial={{
              completed: calendarCompleted as "" | "open" | "done",
              assignee: calendarAssignee,
              status: qstr("status"),
              custom: calendarCustom,
              due: dueParam,
              created: ["today", "7", "30"].includes(qstr("created")) ? qstr("created") : "",
              updated: ["today", "7", "30"].includes(qstr("updated")) ? qstr("updated") : "",
              completedOn: ["today", "7", "30"].includes(qstr("completed_on")) ? qstr("completed_on") : "",
              creator: /^\d+$/.test(qstr("creator")) ? qstr("creator") : qstr("creator") === "none" ? "none" : "",
              weekends: qstr("weekends") !== "0",
              multi: qstr("multi") !== "0",
              color: qstr("color") || "none",
              weekStart: qstr("start") === "1" ? 1 : 0,
            }}
          />
        )}
      </div>
      <Shortcuts projectId={projectId} />
      {task && (
        <TaskPane
          projectId={projectId}
          view={view}
          task={task}
          subtasks={subtasks}
          comments={comments}
          users={users}
          memberships={memberships}
          dependencies={dependencies}
          taskOptions={taskOptions}
          customFields={customFields}
          customValues={customValues[task.id] ?? {}}
          attachments={taskAttachments}
          reactions={reactions}
          events={taskEvents}
          statusOptions={project.status_options ?? []}
        />
      )}
    </div>
  );
}
