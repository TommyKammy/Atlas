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
  getProjectKnowledge,
  getProjectTabs,
  getProjectForms,
  getProjectApps,
  getBundlesForProject,
  getProjectAutomations,
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
  getProjectViewStates,
  getProjectActivity,
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
import KnowledgeView from "@/components/KnowledgeView";
import FormsView from "@/components/FormsView";
import OverviewView from "@/components/OverviewView";
import Shortcuts from "@/components/Shortcuts";
import StarButton from "@/components/StarButton";
import ProjectTitle from "@/components/ProjectTitle";
import ProjectHeaderStatus from "@/components/ProjectHeaderStatus";
import UserAvatar from "@/components/UserAvatar";
import ProjectShareButton from "@/components/ProjectShareButton";
import ProjectCustomizeButton from "@/components/ProjectCustomizeButton";
import TaskPane from "@/components/TaskPane";
import { getCurrentUserId } from "@/lib/current-user";

export const instant = false;

const VIEWS = new Set(["overview", "dashboard", "list", "board", "timeline", "calendar", "messages", "knowledge", "files", "forms"]);

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
  const [sections, tasks, users, members, stats, messages, knowledge, projectTabs, projectForms, projectApps, projectBundles, projectAutomations, customFields, customValues, projectAttachments, savedViews, extras, deps, subtaskMap, prefs, projectActivity] =
    await Promise.all([
      getSections(projectId),
      getProjectTasks(projectId),
      getUsers(),
      getProjectMembers(projectId),
      getProjectStats(projectId),
      getProjectMessages(projectId),
      getProjectKnowledge(projectId),
      getProjectTabs(projectId),
      getProjectForms(projectId),
      getProjectApps(projectId),
      getBundlesForProject(projectId),
      getProjectAutomations(projectId),
      getCustomFields(projectId),
      getTaskCustomValues(projectId),
      getProjectAttachments(projectId),
      getSavedViews(projectId),
      getDashboardExtras(projectId, days),
      getTaskDependencies(projectId),
      getSubtasksBulk(projectId),
      getDashboardPrefs(viewerId, projectId),
      getProjectActivity(projectId),
    ]);

  const viewStates = await getProjectViewStates(viewerId, projectId);
  const storedString = (viewKey: string, key: string, allowed?: readonly string[]) => {
    const v = viewStates[viewKey]?.[key];
    return typeof v === "string" && (allowed === undefined || allowed.includes(v)) ? v : "";
  };
  const storedBool = (viewKey: string, key: string) => viewStates[viewKey]?.[key] === true;

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
        <div className="flex min-w-0 items-center gap-2 px-3 pt-3 sm:gap-3 sm:px-6">
          <ProjectIcon
            id={project.id}
            name={project.name}
            color={project.color}
            icon={project.icon}
            className="h-7 w-7 text-sm"
          />
          <ProjectTitle projectId={projectId} name={project.name} canEdit={access.role === "admin"} />
          <StarButton projectId={projectId} initial={await isFavorite(viewerId, projectId)} />
          <ProjectHeaderStatus
            projectId={projectId}
            initialStatus={project.status}
            initialColor={project.status_color ?? "none"}
            canEdit={access.role === "admin"}
          />
          <span className="flex-1" />
          <span className="hidden -space-x-1 lg:flex">
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
            initialStatusFieldName={project.status_field_name ?? "Status"}
            initialStatusFieldEnabled={project.status_field_enabled !== false}
            initialFields={customFields}
            initialEmailAddress={project.email_address ?? null}
            initialEmailEnabled={project.email_enabled !== false}
            initialApps={projectApps}
            initialBundles={projectBundles}
            initialAutomations={projectAutomations}
            sections={sections}
            users={users}
            role={access.role}
          />
        </div>
        <ProjectTabs
          projectId={projectId}
          active={view}
          activeTabKey={projectTabs.find((tab) => tab.tab_key === qstr("tab"))?.tab_key ?? null}
          tabs={projectTabs}
        />
        <div data-project-view={view}>
        {view === "overview" && (
          <OverviewView
            projectId={projectId}
            stats={stats}
            members={members.map((m) => ({ id: m.id, name: m.name, role: m.role ?? null }))}
            projectStatus={project.status}
            projectStatusColor={project.status_color ?? null}
            projectName={project.name}
            description={project.description ?? ""}
            activity={projectActivity}
            canEdit={access.role === "admin" || access.role === "editor"}
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
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            activeTaskId={taskId}
            initial={{
              hide_completed: activeSaved
                ? activeSaved.filters.hide_completed
                : searchParams.hide !== undefined
                  ? qstr("hide") === "1"
                  : storedBool("list", "hide_completed"),
              assignee: activeSaved
                ? (activeSaved.filters.assignee ?? "")
                : qstr("assignee") !== ""
                  ? qstr("assignee")
                  : storedString("list", "assignee"),
              status: activeSaved
                ? (activeSaved.filters.status ?? "")
                : qstr("status") !== ""
                  ? qstr("status")
                  : storedString("list", "status"),
              due: activeSaved
                ? (activeSaved.filters.due ?? "")
                : dueParam !== ""
                  ? dueParam
                  : storedString("list", "due", ["overdue", "today", "week", "nextweek", "month"]),
              sort:
                activeSaved?.sort_key ??
                (sortRaw !== ""
                  ? sortParam
                  : (storedString("list", "sort", ["due", "name", "progress"]) || "position")),
              sortdir:
                qstr("sortdir") !== ""
                  ? sortDirParam
                  : ((storedString("list", "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
              group:
                activeSaved?.group_by ??
                (groupRaw !== ""
                  ? boardGroup
                  : ((storedString("list", "group", ["assignee", "status"]) || "section") as
                      | "section"
                      | "assignee"
                      | "status")),
            }}
          />
        )}
        {view === "board" && (
          <BoardView
            projectId={projectId}
            sections={sections}
            tasks={tasks}
            users={users}
            initialGroup={
              groupRaw !== ""
                ? boardGroup
                : ((storedString("board", "group", ["assignee", "status"]) || "section") as
                    | "section"
                    | "assignee"
                    | "status")
            }
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            statusOptions={project.status_options ?? []}
            initial={{
              hide_completed:
                searchParams.hide !== undefined ? qstr("hide") === "1" : storedBool("board", "hide_completed"),
              assignee: qstr("assignee") !== "" ? qstr("assignee") : storedString("board", "assignee"),
              status: qstr("status") !== "" ? qstr("status") : storedString("board", "status"),
              sort:
                sortRaw !== ""
                  ? qstr("sort") === "due" || qstr("sort") === "name"
                    ? qstr("sort")
                    : "position"
                  : storedString("board", "sort", ["due", "name"]) || "position",
              sortdir:
                qstr("sortdir") !== ""
                  ? sortDirParam
                  : ((storedString("board", "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
            }}
          />
        )}
        {view === "timeline" && (
          <TimelineView
            projectId={projectId}
            sections={sections}
            tasks={tasks}
            deps={deps}
            startOverride={fromDay}
            initialState={viewStates.timeline}
          />
        )}
        {view === "messages" && <MessagesView projectId={projectId} initial={messages} />}
        {view === "knowledge" && <KnowledgeView projectId={projectId} initial={knowledge} />}
        {view === "forms" && <FormsView projectId={projectId} initial={projectForms} />}
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
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
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
          statusFieldName={project.status_field_name ?? "Status"}
          statusFieldEnabled={project.status_field_enabled !== false}
          viewerId={viewerId}
          viewerCanModerate={access.role === "admin"}
        />
      )}
    </div>
  );
}
