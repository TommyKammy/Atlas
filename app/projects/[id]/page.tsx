import { canConfigureProject } from "@/lib/project-policy";
import { notFound, redirect } from "next/navigation";
import type { TaskRow } from "@/lib/data";
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
import DashboardDrilldownContext from "@/components/dashboard/DashboardDrilldownContext";
import { getDashboardTasks } from "@/lib/dashboard";
import { parseDashboardDrilldown, selectDashboardDrilldownTasks } from "@/lib/dashboard-drilldown";
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
import ProjectActionsButton from "@/components/project/ProjectActionsButton";
import ProjectHeaderStatus from "@/components/ProjectHeaderStatus";
import ProjectMemberFacepile from "@/components/project/ProjectMemberFacepile";
import ProjectShareButton from "@/components/ProjectShareButton";
import ProjectCustomizeButton from "@/components/ProjectCustomizeButton";
import ProjectTaskContextMenu from "@/components/task/ProjectTaskContextMenu";
import { getCurrentUserId } from "@/lib/current-user";
import {
  buildBoardInitial,
  buildBoardInitialGroup,
  buildCalendarInitial,
  buildListInitial,
  parseProjectViewSearch,
  searchParamString,
} from "@/lib/project-view-params";

export const instant = false;

export default async function ProjectPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const projectId = Number(params.id);
  if (!Number.isInteger(projectId)) notFound();

  const project = await getProject(projectId);
  if (!project || project.deleted_at) notFound();

  const parsedSearch = parseProjectViewSearch(searchParams);
  const { explicitView, view, taskId, month, week, savedId, fromDay } = parsedSearch;
  const qstr = (k: string) => searchParamString(searchParams, k);

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
    projectRules,
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

  const hasDashboardSelection = view === "list" && searchParams.dashboard !== undefined;
  const dashboardSelection = hasDashboardSelection ? parseDashboardDrilldown(qstr("dashboard")) : null;
  const [listData, dashboardSelectionTasks] = view === "list"
    ? await Promise.all([
        getListViewData(projectId),
        dashboardSelection ? getDashboardTasks(projectId) : Promise.resolve(null),
      ])
    : [null, null];
  const dashboardTaskIds = dashboardSelection && dashboardSelectionTasks
    ? new Set(selectDashboardDrilldownTasks(dashboardSelectionTasks, dashboardSelection).map((task) => task.id))
    : new Set<number>();
  // Reuse the dashboard's project-local section/date projection. URL values can
  // only narrow tasks that the normal authorized list loader already returned.
  const listTasks = !listData ? [] : hasDashboardSelection
    ? listData.tasks.filter((task) => dashboardTaskIds.has(task.id))
    : listData.tasks;
  const boardData = view === "board" ? await getBoardViewData(projectId) : null;
  const timelineData = view === "timeline" ? await getTimelineViewData(projectId) : null;
  const calendarData = view === "calendar" ? await getCalendarViewData(projectId) : null;
  const overviewData = view === "overview" ? await getOverviewViewData(projectId) : null;
  const dashboardData = view === "dashboard" ? await getDashboardViewData(projectId) : null;
  const messagesData = view === "messages" ? await getMessagesViewData(projectId) : null;
  const knowledgeData = view === "knowledge" ? await getKnowledgeViewData(projectId) : null;
  const formsData = view === "forms" ? await getFormsViewData(projectId) : null;
  const filesData = view === "files" ? await getFilesViewData(projectId) : null;

  const contextTasks = (() => {
    if (listData) {
      const map = new Map<number, TaskRow>();
      for (const item of listData.tasks) map.set(item.id, item);
      for (const items of Object.values(listData.subtaskMap)) {
        for (const item of items) map.set(item.id, item);
      }
      return [...map.values()];
    }
    if (boardData) return boardData.tasks;
    if (calendarData) return calendarData.tasks;
    return [];
  })();

  const savedView = view === "list" && savedId && !hasDashboardSelection ? await getSavedView(savedId) : undefined;
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
  const listInitial = buildListInitial({
    searchParams,
    stored: hasDashboardSelection ? undefined : viewStates.list,
    saved: activeSaved,
    statusFieldEnabled: project.status_field_enabled !== false,
  });
  // Dashboard counts cover main tasks; users may explicitly expand their
  // subtasks later without changing the selected aggregate's meaning.
  if (hasDashboardSelection && qstr("subtasks") === "") listInitial.subtasks_collapsed = true;
  const boardInitial = buildBoardInitial({ searchParams, stored: viewStates.board });
  const boardInitialGroup = buildBoardInitialGroup({
    searchParams,
    stored: viewStates.board,
    statusFieldEnabled: project.status_field_enabled !== false,
  });
  const calendarInitial = buildCalendarInitial({ searchParams, stored: viewStates.calendar });

  const canConfigure = canConfigureProject(access.role, project.settings);

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
          <ProjectTitle projectId={projectId} name={project.name} canEdit={canConfigure} />
          <ProjectActionsButton
            project={{
              id: project.id,
              name: project.name,
              description: project.description ?? "",
              color: project.color ?? null,
              icon: project.icon ?? null,
            }}
            role={access.role}
            projectSettings={project.settings}
            customFields={customFields}
          />
          <StarButton projectId={projectId} initial={favorite} />
          <ProjectHeaderStatus
            projectId={projectId}
            initialStatus={project.status}
            initialColor={project.status_color ?? "none"}
            canEdit={canConfigure}
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
            initialStatusOptionsVersion={project.status_options_version}
            initialStatusFieldName={project.status_field_name ?? "Status"}
            initialStatusFieldEnabled={project.status_field_enabled !== false}
            initialFields={customFields}
            initialEmailAddress={project.email_address ?? null}
            initialEmailEnabled={project.email_enabled !== false}
            initialApps={projectApps}
            initialBundles={projectBundles}
            initialRules={projectRules}
            sections={sections}
            users={users}
            role={access.role}
            projectSettings={project.settings}
          />
        </div>
        <ProjectTabs
          projectId={projectId}
          active={view}
          activeTabKey={projectTabs.find((tab) => tab.tab_key === qstr("tab"))?.tab_key ?? null}
          tabs={projectTabs}
          defaultTabKey={typeof viewStates.tabs?.default === "string" ? viewStates.tabs.default : null}
          canEdit={canConfigure}
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
            canEdit={canConfigure}
          />
        )}
        {view === "dashboard" && dashboardData && (
          <LazyDashboardView
            projectId={projectId}
            projectName={project.name}
            tasks={dashboardData.tasks}
            widgets={dashboardData.widgets}
            sections={sections.map((section) => ({ id: section.id, name: section.name }))}
            users={users.map((user) => ({ id: user.id, name: user.name }))}
            statusOptions={project.status_options ?? []}
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            canEdit={canConfigure}
          />
        )}
        {view === "list" && listData && (
          <>
          {hasDashboardSelection && (
            <DashboardDrilldownContext
              projectId={projectId}
              selection={dashboardSelection}
              count={listTasks.length}
              meta={{
                sections: sections.map((section) => ({ id: section.id, name: section.name })),
                users: users.map((user) => ({ id: user.id, name: user.name })),
                statusOptions: project.status_options ?? [],
                statusFieldName: project.status_field_name ?? "Status",
                statusFieldEnabled: project.status_field_enabled !== false,
              }}
            />
          )}
          <ListView
            key={hasDashboardSelection
              ? `list-${projectId}-dashboard-${dashboardSelection ? JSON.stringify(dashboardSelection) : "invalid"}-${JSON.stringify(listInitial)}`
              : `list-${projectId}`}
            projectId={projectId}
            sections={sections}
            tasks={listTasks}
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
            canAdmin={access.role === "admin"}
            initial={listInitial}
            persistViewState={!hasDashboardSelection}
            canSaveView={!hasDashboardSelection}
            emptyState={hasDashboardSelection ? "filtered" : "project"}
          />
          </>
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
            initialGroup={boardInitialGroup}
            statusFieldName={project.status_field_name ?? "Status"}
            statusFieldEnabled={project.status_field_enabled !== false}
            statusOptions={project.status_options ?? []}
            initial={boardInitial}
          />
        )}
        {view === "timeline" && timelineData && (
          <LazyTimelineView
            key={`timeline-${projectId}`}
            projectId={projectId}
            sections={sections}
            taskPayload={timelineData.tasks}
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
          <LazyFormsView canConfigure={canConfigure} projectId={projectId} initial={formsData.forms} />
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
            initial={calendarInitial}
          />
        )}
        </div>
      </div>
      <Shortcuts projectId={projectId} />
      {view !== "timeline" && (
        <ProjectTaskContextMenu
          projectId={projectId}
          tasks={contextTasks}
          canEdit={access.role === "admin" || access.role === "editor"}
        />
      )}
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
          canEdit={access.role === "admin" || access.role === "editor"}
          canAdmin={access.role === "admin"}
        />
      )}
    </div>
  );
}
