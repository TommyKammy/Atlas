"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import {
  HOME_WIDGET_META,
  type HomeCommentDraft,
  type HomeForm,
  type HomeMember,
  type HomeMention,
  type HomeNotepad,
  type HomePortfolioProject,
  type HomeProject,
  type HomeStatusProject,
  type HomeStatusUpdate,
  type HomeTask,
  type HomeWidget,
} from "@/lib/home-widgets";
import { patchTask } from "@/lib/task-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import AddWidgetPanel from "./AddWidgetPanel";
import HomeTaskComposer from "./HomeTaskComposer";
import HomeWidgetCard, { type HomeWidgetMenuItem } from "./HomeWidgetCard";
import AssignedTasksWidget from "./widgets/AssignedTasksWidget";
import CommentDraftsWidget from "./widgets/CommentDraftsWidget";
import FormsWidget from "./widgets/FormsWidget";
import MembersWidget from "./widgets/MembersWidget";
import MentionsWidget from "./widgets/MentionsWidget";
import MyTasksWidget from "./widgets/MyTasksWidget";
import NotepadWidget from "./widgets/NotepadWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import ProjectsWidget from "./widgets/ProjectsWidget";
import StatusUpdatesWidget from "./widgets/StatusUpdatesWidget";

export default function HomeDashboard({
  canCreateProject,
  userId,
  today,
  dateLine,
  greeting,
  myTaskCount,
  unreadCount,
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
  users,
}: {
  canCreateProject: boolean;
  userId: number;
  today: string;
  dateLine: string;
  greeting: string;
  myTaskCount: number;
  unreadCount: number;
  widgets: HomeWidget[];
  myTasks: HomeTask[];
  assignedTasks: HomeTask[];
  projects: HomeProject[];
  members: HomeMember[];
  portfolio: HomePortfolioProject[];
  statusUpdates: HomeStatusUpdate[];
  statusProjects: HomeStatusProject[];
  forms: HomeForm[];
  mentions: HomeMention[];
  commentDrafts: HomeCommentDraft[];
  notepad: HomeNotepad;
  users: { id: number; name: string; avatar_url?: string | null }[];
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [showCompleted, setShowCompleted] = useState(true);
  const [collaborator, setCollaborator] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [composer, setComposer] = useState<"my_tasks" | "assigned_tasks" | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const collaboratorId = collaborator === "" ? null : Number(collaborator);
  const matchesCollaborator = (task: HomeTask) =>
    collaboratorId === null ||
    task.assignee_id === collaboratorId ||
    (task.collaborators ?? []).some((person) => person.id === collaboratorId);
  const visibleMyTasks = myTasks.filter(matchesCollaborator);
  const visibleAssignedTasks = assignedTasks.filter(matchesCollaborator);
  const visibleMembers =
    collaboratorId === null ? members : members.filter((member) => member.id === collaboratorId);

  const refresh = () => router.refresh();

  const removeWidget = async (widget: HomeWidget) => {
    if (!(await confirmAction("このウィジェットを削除しますか？"))) return;
    await api(`/api/home/widgets/${widget.id}`, "DELETE");
    refresh();
  };

  const setWidgetSize = async (widget: HomeWidget, size: "half" | "full") => {
    if (widget.size === size) return;
    await api(`/api/home/widgets/${widget.id}`, "PATCH", { size });
    refresh();
  };

  const addWidget = async (type: HomeWidget["widget_type"]) => {
    await api("/api/home/widgets", "POST", { widget_type: type });
    setAddOpen(false);
    refresh();
  };

  const reorder = async (sourceId: number, targetId: number) => {
    if (sourceId === targetId) return;
    const ids = widgets.map((widget) => widget.id).filter((id) => id !== sourceId);
    const targetIndex = ids.indexOf(targetId);
    ids.splice(targetIndex < 0 ? ids.length : targetIndex, 0, sourceId);
    setDraggingId(null);
    await api("/api/home/widgets", "PATCH", { order: ids });
    refresh();
  };

  const toggleTask = async (task: HomeTask) => {
    setBusyTaskId(task.id);
    try {
      await patchTask(task.id, { completed: !task.completed }, task.updated_at);
      refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "タスクの更新に失敗しました");
    } finally {
      setBusyTaskId(null);
    }
  };

  const commonMenu = (widget: HomeWidget): HomeWidgetMenuItem[] => [
    { label: "ハーフサイズ", checked: widget.size === "half", onClick: () => void setWidgetSize(widget, "half") },
    { label: "フルサイズ", checked: widget.size === "full", onClick: () => void setWidgetSize(widget, "full") },
    { label: "ウィジェットを削除", danger: true, onClick: () => void removeWidget(widget) },
  ];

  const menuFor = (widget: HomeWidget): HomeWidgetMenuItem[] => {
    if (widget.widget_type === "my_tasks") {
      return [
        { label: "＋ タスクを作成", onClick: () => setComposer("my_tasks") },
        { label: "マイタスクをすべて表示", onClick: () => router.push("/my-tasks") },
        ...commonMenu(widget),
      ];
    }
    if (widget.widget_type === "assigned_tasks") {
      return [
        { label: "＋ タスクを割り当てる", onClick: () => setComposer("assigned_tasks") },
        ...commonMenu(widget),
      ];
    }
    if (widget.widget_type === "projects") {
      return [
        { label: "プロジェクトをすべて表示", onClick: () => router.push("/portfolio") },
        ...commonMenu(widget),
      ];
    }
    if (widget.widget_type === "portfolio") {
      return [
        { label: "ポートフォリオをすべて表示", onClick: () => router.push("/portfolio") },
        ...commonMenu(widget),
      ];
    }
    if (widget.widget_type === "mentions") {
      return [
        { label: "受信トレイを開く", onClick: () => router.push("/inbox") },
        ...commonMenu(widget),
      ];
    }
    if (widget.widget_type === "forms") {
      return [
        { label: "プロジェクトをすべて表示", onClick: () => router.push("/portfolio") },
        ...commonMenu(widget),
      ];
    }
    return commonMenu(widget);
  };

  return (
    <div data-home-dashboard className="px-6 py-6 pb-16">
      <div className="text-[13px] text-secondary">{dateLine}</div>
      <h1 className="mt-1 text-[30px] leading-10 font-normal text-text">{greeting}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <Link
          href="/my-tasks"
          className="rounded-md border border-line bg-surface px-2 py-1 text-secondary hover:bg-hover"
        >
          マイタスク（担当 {myTaskCount}）
        </Link>
        <Link
          href="/inbox"
          className="rounded-md border border-line bg-surface px-2 py-1 text-secondary hover:bg-hover"
        >
          受信トレイ（未読 {unreadCount}）
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-line pb-2 text-[12px] text-muted">
        <label className="flex items-center gap-1">
          <span>期間</span>
          <select
            data-home-period
            value={period}
            onChange={(event) => setPeriod(event.target.value as "week" | "month")}
            className="rounded border border-line bg-white px-1.5 py-0.5 text-[12px]"
          >
            <option value="week">週</option>
            <option value="month">月</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            data-home-show-completed
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.target.checked)}
          />
          完了済みのタスク
        </label>
        <label className="flex items-center gap-1">
          <span>コラボレーター</span>
          <select
            data-home-collaborator
            value={collaborator}
            onChange={(event) => setCollaborator(event.target.value)}
            className="max-w-[180px] rounded border border-line bg-white px-1.5 py-0.5 text-[12px]"
          >
            <option value="">全員</option>
            {users
              .filter((user) => user.id !== userId)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
        <span className="flex-1" />
        <button
          type="button"
          data-home-add-widget-button
          onClick={() => setAddOpen(true)}
          className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary hover:bg-hover"
        >
          ＋ ウィジェットを追加
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {widgets.map((widget) => (
          <HomeWidgetCard
            key={widget.id}
            widgetId={widget.id}
            widgetType={widget.widget_type}
            size={widget.size}
            title={HOME_WIDGET_META[widget.widget_type].label}
            locked={widget.widget_type === "my_tasks" || widget.widget_type === "notepad" || widget.widget_type === "comment_drafts"}
            menuItems={menuFor(widget)}
            onDragStart={() => setDraggingId(widget.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const source = Number(event.dataTransfer.getData("text/home-widget")) || draggingId;
              if (source) void reorder(source, widget.id);
            }}
            dragging={draggingId === widget.id}
            className={widget.size === "full" ? "xl:col-span-2" : ""}
          >
            {widget.widget_type === "my_tasks" && (
              <MyTasksWidget
                tasks={visibleMyTasks}
                today={today}
                period={period}
                showCompleted={showCompleted}
                busyTaskId={busyTaskId}
                onCompose={() => setComposer("my_tasks")}
                onToggle={(task) => void toggleTask(task)}
              />
            )}
            {widget.widget_type === "projects" && (
              <ProjectsWidget canCreateProject={canCreateProject} projects={projects} />
            )}
            {widget.widget_type === "assigned_tasks" && (
              <AssignedTasksWidget
                tasks={visibleAssignedTasks}
                today={today}
                period={period}
                showCompleted={showCompleted}
                busyTaskId={busyTaskId}
                onCompose={() => setComposer("assigned_tasks")}
                onToggle={(task) => void toggleTask(task)}
              />
            )}
            {widget.widget_type === "members" && <MembersWidget members={visibleMembers} />}
            {widget.widget_type === "portfolio" && <PortfolioWidget projects={portfolio} />}
            {widget.widget_type === "status_updates" && (
              <StatusUpdatesWidget updates={statusUpdates} projects={statusProjects} />
            )}
            {widget.widget_type === "forms" && <FormsWidget forms={forms} />}
            {widget.widget_type === "mentions" && <MentionsWidget mentions={mentions} />}
            {widget.widget_type === "comment_drafts" && (
              <CommentDraftsWidget drafts={commentDrafts} />
            )}
            {widget.widget_type === "notepad" && <NotepadWidget initial={notepad} />}
          </HomeWidgetCard>
        ))}
      </div>

      <AddWidgetPanel
        open={addOpen}
        existingTypes={widgets.map((widget) => widget.widget_type)}
        onAdd={(type) => void addWidget(type)}
        onClose={() => setAddOpen(false)}
      />
      <HomeTaskComposer
        open={composer !== null}
        mode={composer ?? "my_tasks"}
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        users={users}
        viewerId={userId}
        onClose={() => setComposer(null)}
        onCreated={refresh}
      />
    </div>
  );
}
