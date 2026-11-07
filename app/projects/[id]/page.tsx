import { notFound } from "next/navigation";
import {
  getProject,
  getProjectAccess,
  getProjectViewStates,
  getSavedView,
  getTaskForProject,
  touchRecentProject,
} from "@/lib/data";
import {
  getProjectShellData,
  getListViewData,
  getBoardViewData,
  getTimelineViewData,
  getCalendarViewData,
  getOverviewViewData,
  getDashboardViewData,
  getMessagesViewData,
  getKnowledgeViewData,
  getFormsViewData,
  getFilesViewData,
  getTaskPaneData,
} from "@/lib/repositories/project-page";
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
import ProjectMemberFacepile from "@/components/project/ProjectMemberFacepile";
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
  const viewerId = await getCurrentUserId();
  if (!viewerId) notFound();
  const access = await getProjectAccess(viewerId, projectId);
  if (!access.role) notFound();
  const shell = await getProjectShellData(projectId, viewerId);
  const {
    sections,
    users,
    members,
    projectTabs,
    customFields,
    projectApps,
    projectBundles,
    projectAutomations,
    favorite,
  } = shell;

  const needsViewState = view === "list" || view === "board" || view === "timeline" || view === "calendar";
  const viewStates = needsViewState ? await getProjectViewStates(viewerId, projectId) : {};

  const listData = view === "list" ? await getListViewData(projectId) : null;
  const boardData = view === "board" ? await getBoardViewData(projectId) : null;
  const timelineData = view === "timeline" ? await getTimelineViewData(projectId) : null;
  const calendarData = view === "calendar" ? await getCalendarViewData(projectId) : null;
  const overviewData = view === "overview" ? await getOverviewViewData(projectId) : null;
  const dashboardData = view === "dashboard" ? await getDashboardViewData(projectId, viewerId, days) : null;
  const messagesData = view === "messages" ? await getMessagesViewData(projectId) : null;
  const knowledgeData = view === "knowledge" ? await getKnowledgeViewData(projectId) : null;
  const formsData = view === "forms" ? await getFormsViewData(projectId) : null;
  const filesData = view === "files" ? await getFilesViewData(projectId) : null;

  const calendarStored: Record<string, string | number | boolean | null> = viewStates.calendar ?? {};
  const calendarExplicit =
    ["completed", "hide", "assignee", "status", "due", "created", "updated", "completed_on", "creator", "weekends", "multi", "color", "start"].some(
      (key) => qstr(key) !== "",
    ) || Object.keys(searchParams).some((key) => key.startsWith("cf_"));
  const calPick = (key: string) => {
    const urlValue = qstr(key);
    if (urlValue !== "") return urlValue;
    if (calendarExplicit) return "";
    const stored = calendarStored[key];
    return typeof stored === "string" ? stored : "";
  };
  const calendarAssignee = /^\d+$/.test(calPick("assignee"))
    ? calPick("assignee")
    : calPick("assignee") === "none"
      ? "none"
      : "";
  const calendarCompleted =
    qstr("completed") === "open" || qstr("completed") === "done"
      ? qstr("completed")
      : qstr("hide") === "1"
        ? "open"
        : !calendarExplicit && (calendarStored.completed === "open" || calendarStored.completed === "done")
          ? calendarStored.completed
          : "";
  const calendarCustom: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key.startsWith("cf_") && typeof value === "string" && value) {
      calendarCustom[key.slice(3)] = value;
    }
  }
  if (Object.keys(calendarCustom).length === 0 && !calendarExplicit && typeof calendarStored.custom === "string") {
    try {
      const parsed = JSON.parse(calendarStored.custom) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value !== "") calendarCustom[key] = value;
        }
      }
    } catch {
      /* ignore malformed stored filter */
    }
  }
  const calendarBool = (key: string, fallback: boolean) => {
    const urlValue = qstr(key);
    if (urlValue !== "") return urlValue !== "0";
    if (calendarExplicit) return fallback;
    return typeof calendarStored[key] === "boolean" ? (calendarStored[key] as boolean) : fallback;
  };

  const storedString = (viewKey: string, key: string, allowed?: readonly string[]) => {
    const v = viewStates[viewKey]?.[key];
    return typeof v === "string" && (allowed === undefined || allowed.includes(v)) ? v : "";
  };
  const storedBool = (viewKey: string, key: string) => viewStates[viewKey]?.[key] === true;

  const savedView = view === "list" && savedId ? await getSavedView(savedId) : undefined;
  const activeSaved =
    savedView && savedView.project_id === projectId && savedView.view_type === "list" ? savedView : undefined;

  const task = taskId ? await getTaskForProject(taskId, projectId) : undefined;
  await touchRecentProject(viewerId, projectId);
  const paneData = task ? await getTaskPaneData(task.id, projectId, viewerId) : null;

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
          <StarButton projectId={projectId} initial={favorite} />
          <ProjectHeaderStatus
            projectId={projectId}
            initialStatus={project.status}
            initialColor={project.status_color ?? "none"}
            canEdit={access.role === "admin"}
          />
          <span className="flex-1" />
          <ProjectMemberFacepile
            projectId={projectId}
            projectName={project.name}
            members={members.map((m) => ({ id: m.id, name: m.name, avatar_url: m.avatar_url ?? null }))}
          />
          <ProjectShareButton projectId={projectId} projectName={project.name} />
          <ProjectCustomizeButton
            key={`customize-${projectId}`}
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
        {view === "overview" && overviewData && (
          <OverviewView
            projectId={projectId}
            stats={overviewData.stats}
            members={members.map((m) => ({ id: m.id, name: m.name, role: m.role ?? null }))}
            projectStatus={project.status}
            projectStatusColor={project.status_color ?? null}
            projectName={project.name}
            description={project.description ?? ""}
            activity={overviewData.activity}
            canEdit={access.role === "admin" || access.role === "editor"}
          />
        )}
        {view === "dashboard" && dashboardData && (
          <DashboardView
            projectId={projectId}
            stats={dashboardData.stats}
            extras={dashboardData.extras}
            days={days}
            prefs={dashboardData.prefs}
          />
        )}
        {view === "list" && listData && (
          <ListView
            key={`list-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={listData.tasks}
            users={users}
            customFields={customFields}
            customValues={listData.customValues}
            savedViews={listData.savedViews}
            subtaskMap={listData.subtaskMap}
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
        {view === "board" && boardData && (
          <BoardView
            key={`board-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={boardData.tasks}
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
        {view === "timeline" && timelineData && (
          <TimelineView
            key={`timeline-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={timelineData.tasks}
            deps={timelineData.deps}
            startOverride={fromDay}
            initialState={viewStates.timeline}
          />
        )}
        {view === "messages" && messagesData && (
          <MessagesView projectId={projectId} initial={messagesData.messages} />
        )}
        {view === "knowledge" && knowledgeData && (
          <KnowledgeView projectId={projectId} initial={knowledgeData.knowledge} />
        )}
        {view === "forms" && formsData && (
          <FormsView projectId={projectId} initial={formsData.forms} />
        )}
        {view === "files" && filesData && (
          <FilesView projectId={projectId} attachments={filesData.attachments} />
        )}
        {view === "calendar" && calendarData && (
          <CalendarView
            key={`calendar-${projectId}`}
            projectId={projectId}
            tasks={calendarData.tasks}
            sections={sections}
            users={users}
            customFields={customFields}
            customValues={calendarData.customValues}
            projectStatusOptions={project.status_options ?? []}
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            viewerId={viewerId}
            month={month}
            week={week}
            initial={{
              completed: calendarCompleted as "" | "open" | "done",
              assignee: calendarAssignee,
              status: calPick("status"),
              custom: calendarCustom,
              due: calPick("due") || dueParam,
              created: ["today", "7", "30"].includes(calPick("created")) ? calPick("created") : "",
              updated: ["today", "7", "30"].includes(calPick("updated")) ? calPick("updated") : "",
              completedOn: ["today", "7", "30"].includes(calPick("completed_on")) ? calPick("completed_on") : "",
              creator: /^\d+$/.test(calPick("creator"))
                ? calPick("creator")
                : calPick("creator") === "none"
                  ? "none"
                  : "",
              weekends: calendarBool("weekends", true),
              multi: calendarBool("multi", true),
              color: calPick("color") || "none",
              weekStart: calPick("start") === "1" ? 1 : 0,
            }}
          />
        )}
        </div>
      </div>
      <Shortcuts projectId={projectId} />
      {task && paneData && (
        <TaskPane
          key={`task-${task.id}`}
          projectId={projectId}
          view={view}
          task={task}
          subtasks={paneData.subtasks}
          comments={paneData.comments}
          users={users}
          memberships={paneData.memberships}
          dependencies={paneData.dependencies}
          taskOptions={paneData.taskOptions}
          customFields={customFields}
          customValues={paneData.customValues[task.id] ?? {}}
          attachments={paneData.attachments}
          reactions={paneData.reactions}
          events={paneData.events}
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
