import { notFound, redirect } from "next/navigation";
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
import {
  LazyBoardView,
  LazyTimelineView,
  LazyCalendarView,
  LazyDashboardView,
  LazyFilesView,
  LazyMessagesView,
  LazyKnowledgeView,
  LazyFormsView,
  LazyOverviewView,
  LazyTaskPane,
} from "@/components/project/LazyViews";
import Shortcuts from "@/components/Shortcuts";
import StarButton from "@/components/StarButton";
import ProjectTitle from "@/components/ProjectTitle";
import ProjectHeaderStatus from "@/components/ProjectHeaderStatus";
import ProjectMemberFacepile from "@/components/project/ProjectMemberFacepile";
import ProjectShareButton from "@/components/ProjectShareButton";
import ProjectCustomizeButton from "@/components/ProjectCustomizeButton";
import { getCurrentUserId } from "@/lib/current-user";
import { parseListDateFilter, parseListGroupBy, parseListSortKey } from "@/lib/list-view";

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

  const explicitView =
    typeof searchParams.view === "string" && VIEWS.has(searchParams.view)
      ? searchParams.view
      : null;
  const view = explicitView ?? "list";
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
  const sortDirParam = qstr("sortdir") === "desc" ? "desc" : "asc";
  const dueParam = ["overdue", "today", "week", "nextweek", "month"].includes(qstr("due"))
    ? qstr("due")
    : "";
  const fromRaw = qstr("from");
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && !Number.isNaN(Date.parse(fromRaw))
    ? Math.floor(Date.parse(fromRaw) / 86400000)
    : null;
  const groupRaw = qstr("group");
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

  const viewStates = await getProjectViewStates(viewerId, projectId);
  if (!explicitView) {
    const preferred = typeof viewStates.tabs?.default === "string" ? viewStates.tabs.default : null;
    const defaultTab = preferred ? projectTabs.find((tab) => tab.tab_key === preferred) : undefined;
    if (defaultTab) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(searchParams)) {
        if (typeof value === "string") params.set(key, value);
        else if (Array.isArray(value)) for (const item of value) params.append(key, item);
      }
      params.set("view", defaultTab.view_type);
      params.set("tab", defaultTab.tab_key);
      redirect(`/projects/${projectId}?${params.toString()}`);
    }
  }

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
  const storedBoolDefault = (viewKey: string, key: string, fallback: boolean) => {
    const value = viewStates[viewKey]?.[key];
    return typeof value === "boolean" ? value : fallback;
  };

  const savedView = view === "list" && savedId ? await getSavedView(savedId) : undefined;
  const activeSaved =
    savedView && savedView.project_id === projectId && savedView.view_type === "list" ? savedView : undefined;

  const task = taskId ? await getTaskForProject(taskId, projectId) : undefined;
  await touchRecentProject(viewerId, projectId);
  const paneData = task ? await getTaskPaneData(task.id, projectId, viewerId) : null;

  const tabParam = qstr("tab");
  const activeTab = tabParam ? projectTabs.find((tab) => tab.tab_key === tabParam) : undefined;
  const activeTabFor = (viewType: string) =>
    activeTab?.view_type === viewType
      ? activeTab
      : projectTabs.find((tab) => tab.view_type === viewType);
  const activeListTab = activeTabFor("list");
  const activeBoardTab = activeTabFor("board");
  const activeTimelineTab = activeTabFor("timeline");
  const activeCalendarTab = activeTabFor("calendar");
  const listSort = parseListSortKey(
    activeSaved
      ? activeSaved.sort_key
      : sortRaw !== ""
        ? sortRaw
        : storedString("list", "sort"),
  );
  const listSortDir =
    qstr("sortdir") !== ""
      ? sortDirParam
      : ((storedString("list", "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc");
  const listGroup = parseListGroupBy(
    activeSaved
      ? activeSaved.group_by
      : groupRaw !== ""
        ? groupRaw
        : storedString("list", "group"),
    project.status_field_enabled !== false,
  );
  const rawGroup2 =
    activeSaved
      ? (activeSaved.filters.group2 ?? "")
      : qstr("group2") !== ""
        ? qstr("group2")
        : storedString("list", "group2");
  const parsedGroup2 = rawGroup2 ? parseListGroupBy(rawGroup2, project.status_field_enabled !== false) : null;
  const listGroup2 =
    parsedGroup2 && (parsedGroup2 !== "section" || rawGroup2 === "section") ? parsedGroup2 : null;
  const listGroupDir =
    activeSaved
      ? activeSaved.filters.groupdir === "desc"
        ? "desc"
        : "asc"
      : qstr("groupdir") !== ""
        ? qstr("groupdir") === "desc"
          ? "desc"
          : "asc"
        : ((storedString("list", "groupdir", ["asc", "desc"]) || "asc") as "asc" | "desc");
  const listSubtasksCollapsed = activeSaved
    ? activeSaved.filters.subtasks_collapsed === true
    : qstr("subtasks") !== ""
      ? qstr("subtasks") === "collapsed"
      : storedBool("list", "subtasks_collapsed");
  const listInitial = {
    hide_completed: activeSaved
      ? activeSaved.filters.hide_completed === true
      : searchParams.hide !== undefined
        ? qstr("hide") === "1"
        : qstr("completed") === "open"
          ? true
          : storedBool("list", "hide_completed"),
    completed_only: activeSaved
      ? activeSaved.filters.completed_only === true
      : qstr("completed") === "done"
        ? true
        : storedBool("list", "completed_only"),
    mine_only: activeSaved
      ? activeSaved.filters.mine_only === true
      : qstr("mine") !== ""
        ? qstr("mine") === "1"
        : storedBool("list", "mine_only"),
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
    start: activeSaved
      ? parseListDateFilter(activeSaved.filters.start)
      : qstr("start") !== ""
        ? parseListDateFilter(qstr("start"))
        : parseListDateFilter(storedString("list", "start")),
    creator: activeSaved
      ? (activeSaved.filters.creator ?? "")
      : qstr("creator") !== ""
        ? qstr("creator")
        : storedString("list", "creator"),
    created: activeSaved
      ? parseListDateFilter(activeSaved.filters.created)
      : qstr("created") !== ""
        ? parseListDateFilter(qstr("created"))
        : parseListDateFilter(storedString("list", "created")),
    updated: activeSaved
      ? parseListDateFilter(activeSaved.filters.updated)
      : qstr("updated") !== ""
        ? parseListDateFilter(qstr("updated"))
        : parseListDateFilter(storedString("list", "updated")),
    completed_on: activeSaved
      ? parseListDateFilter(activeSaved.filters.completed_on)
      : qstr("completed_on") !== ""
        ? parseListDateFilter(qstr("completed_on"))
        : parseListDateFilter(storedString("list", "completed_on")),
    sort: listSort,
    sortdir: listSortDir,
    group: listGroup,
    group2: listGroup2 ?? undefined,
    groupdir: listGroupDir,
    subtasks_collapsed: listSubtasksCollapsed,
  };

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
          defaultTabKey={typeof viewStates.tabs?.default === "string" ? viewStates.tabs.default : null}
          canEdit={access.role === "admin" || access.role === "editor"}
        />
        <div data-project-view={view}>
        {view === "overview" && overviewData && (
          <LazyOverviewView
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
          <LazyDashboardView
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
            viewerId={viewerId}
            viewName={activeListTab?.name ?? "リスト"}
            viewIcon={activeListTab?.icon ?? null}
            viewTabId={activeListTab && activeListTab.id > 0 ? activeListTab.id : null}
            canEdit={access.role === "admin" || access.role === "editor"}
            initial={listInitial}
          />
        )}
        {view === "board" && boardData && (
          <LazyBoardView
            key={`board-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={boardData.tasks}
            users={users}
            viewerId={viewerId}
            viewName={activeBoardTab?.name ?? "ボード"}
            viewIcon={activeBoardTab?.icon ?? null}
            viewTabId={activeBoardTab && activeBoardTab.id > 0 ? activeBoardTab.id : null}
            canEdit={access.role === "admin" || access.role === "editor"}
            initialGroup={parseListGroupBy(
              groupRaw !== "" ? groupRaw : storedString("board", "group"),
              project.status_field_enabled !== false,
            )}
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            statusOptions={project.status_options ?? []}
            initial={{
              hide_completed:
                searchParams.hide !== undefined
                  ? qstr("hide") === "1"
                  : storedBoolDefault("board", "hide_completed", false),
              completed_only:
                qstr("completed") === "done" || storedBoolDefault("board", "completed_only", false),
              mine_only:
                qstr("mine") !== ""
                  ? qstr("mine") === "1"
                  : storedBoolDefault("board", "mine_only", false),
              assignee: qstr("assignee") !== "" ? qstr("assignee") : storedString("board", "assignee"),
              status: qstr("status") !== "" ? qstr("status") : storedString("board", "status"),
              due:
                qstr("due") !== ""
                  ? qstr("due")
                  : storedString("board", "due", ["overdue", "today", "week", "nextweek", "month"]),
              start:
                qstr("start") !== ""
                  ? qstr("start")
                  : storedString("board", "start"),
              creator: qstr("creator") !== "" ? qstr("creator") : storedString("board", "creator"),
              created:
                qstr("created") !== ""
                  ? qstr("created")
                  : storedString("board", "created"),
              updated:
                qstr("updated") !== ""
                  ? qstr("updated")
                  : storedString("board", "updated"),
              completed_on:
                qstr("completed_on") !== ""
                  ? qstr("completed_on")
                  : storedString("board", "completed_on"),
              sort: parseListSortKey(
                sortRaw !== "" ? sortRaw : storedString("board", "sort"),
              ),
              sortdir:
                qstr("sortdir") !== ""
                  ? sortDirParam
                  : ((storedString("board", "sortdir", ["asc", "desc"]) || "asc") as "asc" | "desc"),
              show_empty_groups: storedBoolDefault("board", "show_empty_groups", true),
              auto_refresh: storedBoolDefault("board", "auto_refresh", true),
              show_assignee: storedBoolDefault("board", "show_assignee", true),
              show_due: storedBoolDefault("board", "show_due", true),
              show_status: storedBoolDefault("board", "show_status", true),
              show_meta: storedBoolDefault("board", "show_meta", true),
            }}
          />
        )}
        {view === "timeline" && timelineData && (
          <LazyTimelineView
            key={`timeline-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={timelineData.tasks}
            deps={timelineData.deps}
            startOverride={fromDay}
            initialState={viewStates.timeline}
            viewName={activeTimelineTab?.name ?? "タイムライン"}
            viewIcon={activeTimelineTab?.icon ?? null}
            viewTabId={activeTimelineTab && activeTimelineTab.id > 0 ? activeTimelineTab.id : null}
            canEdit={access.role === "admin" || access.role === "editor"}
            users={users}
            viewerId={viewerId}
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            statusOptions={project.status_options ?? []}
          />
        )}
        {view === "messages" && messagesData && (
          <LazyMessagesView projectId={projectId} initial={messagesData.messages} />
        )}
        {view === "knowledge" && knowledgeData && (
          <LazyKnowledgeView projectId={projectId} initial={knowledgeData.knowledge} />
        )}
        {view === "forms" && formsData && (
          <LazyFormsView projectId={projectId} initial={formsData.forms} />
        )}
        {view === "files" && filesData && (
          <LazyFilesView projectId={projectId} attachments={filesData.attachments} />
        )}
        {view === "calendar" && calendarData && (
          <LazyCalendarView
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
            viewName={activeCalendarTab?.name ?? "カレンダー"}
            viewIcon={activeCalendarTab?.icon ?? null}
            viewTabId={activeCalendarTab && activeCalendarTab.id > 0 ? activeCalendarTab.id : null}
            canEdit={access.role === "admin" || access.role === "editor"}
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
        <LazyTaskPane
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
