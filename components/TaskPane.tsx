"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Attachment, CommentRow, TaskRow, User } from "@/lib/data";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import {
  customFieldDisplay,
  customFieldInputKey,
  customValueToArray,
  customValueToIdArray,
  customValueToInput,
  isReadOnlyFieldType,
  type CustomField,
  type CustomValue,
} from "@/lib/custom-fields";
import { todayISO } from "@/lib/dates";
import { taskConflictComparisonRows } from "@/lib/task-conflict";
import {
  overdueBadgeText,
  overdueDays,
  taskStateSummary,
} from "@/lib/task-pane-presentation";
import { useFocusTrap } from "@/lib/use-focus-trap";
import TaskPaneHeader from "./task/TaskPaneHeader";
import TaskFieldRow from "./task/TaskFieldRow";
import TaskMilestoneIcon from "./task/TaskMilestoneIcon";
import TaskVisibilityBanner from "./task/TaskVisibilityBanner";
import TaskDescriptionSection from "./task/TaskDescriptionSection";
import TaskDueDateField from "./task/TaskDueDateField";
import TaskSubtasksSection from "./task/TaskSubtasksSection";
import TaskAttachmentsSection from "./task/TaskAttachmentsSection";
import TaskDependenciesSection from "./task/TaskDependenciesSection";
import TaskCustomFieldsSection from "./task/TaskCustomFieldsSection";
import TaskCommentComposer from "./task/TaskCommentComposer";
import TaskFeedSection from "./task/TaskFeedSection";
import ReferencePicker from "./fields/ReferencePicker";
import TimerCell from "./fields/TimerCell";
import AssigneePicker from "./fields/AssigneePicker";
import EmptyCellIcon from "./fields/EmptyCellIcon";
import TaskAvatar from "./task/TaskAvatar";
import TaskStatusChip from "./task/TaskStatusChip";
import TaskApprovalSection from "./task/TaskApprovalSection";
import TaskDraftInput from "./task/TaskDraftInput";
import TaskSaveStatus from "./task/TaskSaveStatus";
import type { TaskApprovalSummary } from "@/lib/task-approval";
import { QUICK_REACTIONS, useTaskPane } from "@/lib/use-task-pane";
import { useQuickTask } from "./task/QuickTaskContext";
import { isImeComposing } from "@/lib/ime-keyboard";

export default function TaskPane({
  projectId,
  view,
  task,
  subtasks,
  comments,
  users,
  memberships,
  dependencies,
  taskOptions,
  customFields,
  customValues,
  attachments,
  reactions,
  events,
  statusOptions,
  statusFieldName,
  statusFieldEnabled,
  viewerId,
  viewerCanModerate,
  canEdit,
  canAdmin,
}: {
  projectId: number;
  view: string;
  task: TaskRow;
  subtasks: TaskRow[];
  comments: CommentRow[];
  users: User[];
  memberships: { id: number; name: string; section_name: string | null }[];
  dependencies: { id: number; name: string }[];
  taskOptions: { id: number; name: string }[];
  customFields: CustomField[];
  customValues: Record<number, CustomValue>;
  attachments: Attachment[];
  reactions: Record<number, { emoji: string; n: number; mine: boolean }[]>;
  events: {
    id: number;
    summary: string;
    actor_name: string | null;
    via: string;
    client_name: string | null;
    created_at: string;
  }[];
  statusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  viewerId: number;
  viewerCanModerate: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}) {
  const {
    router,
    refresh,
    closeHref,
    isOverdue,
    canEditField,
    userName,
    describeValue,
    FIELD_LABELS,
    subtaskDraft,
    setSubtaskDraft,
    addingSubtask,
    setAddingSubtask,
    depDraft,
    setDepDraft,
    conflict,
    discardConflict,
    inputRecovery,
    uploading,
    referenceOpen,
    setReferenceOpen,
    maximized,
    setMaximized,
    showTitle,
    setShowTitle,
    reactionMap,
    feedTab,
    setFeedTab,
    addingProject,
    closeAddProject,
    assigneeEditing,
    setAssigneeEditing,
    allProjects,
    newMemberProject,
    newMemberSections,
    newMemberSection,
    setNewMemberSection,
    toggleReaction,
    updatedAt,
    patch,
    patchChecked,
    saveStates,
    reloading,
    reloadRevision,
    reloadTask,
    retryOverwrite,
    toggle,
    remove,
    copyTaskLink,
    shareTask,
    mentionUsers,
    addComment,
    saveComment,
    deleteComment,
    addSubtask,
    addDependency,
    removeDependency,
    openAddProject,
    onPickMemberProject,
    addMembership,
    removeMembership,
    setCustomValue,
    uploadFile,
    removeAttachment,
    toggleSubtaskCompletion,
    deleteSubtask,
  } = useTaskPane({
    projectId,
    view,
    task,
    users,
    reactions,
    viewerId,
    canEdit,
    canAdmin,
    statusFieldName,
  });

  const paneRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quick = useQuickTask();
  const paneDraft = quick?.paneDraft ?? null;
  // The URL task is still the fallback while the draft is unsaved. Once the
  // draft receives its server id, the pushed URL renders the normal pane.
  const draftActive = Boolean(paneDraft && paneDraft.task.id !== task.id);
  const [approvalOverride, setApprovalOverride] = useState<{ taskId: number; stamp: string; approval: TaskApprovalSummary | null } | null>(null);
  const [approvalOpenSignal, setApprovalOpenSignal] = useState(0);
  const approval = approvalOverride?.taskId === task.id && approvalOverride.stamp === task.updated_at ? approvalOverride.approval : task.approval;
  useFocusTrap(paneRef, true, () => router.push(closeHref), draftActive);

  const renderCustomEditor = (field: CustomField) => {
    const value = customValues[field.id];
    if (isReadOnlyFieldType(field.field_type) || !canEditField(field)) {
      return (
        <div
          key={`cf-${task.id}-${field.id}`}
          className="min-h-7 py-1 text-[13px] text-text"
          data-custom-readonly={field.field_type}
        >
          {customFieldDisplay(field, value, task, users, customValues, customFields)}
        </div>
      );
    }
    if (field.field_type === "timer") {
      return (
        <TimerCell
          key={`cf-${task.id}-${field.id}`}
          taskId={task.id}
          field={field}
          value={value}
          onChanged={refresh}
        />
      );
    }
    if (field.field_type === "reference") {
      return (
        <div className="relative" key={`cf-${task.id}-${field.id}`}>
          <button
            type="button"
            onClick={() => setReferenceOpen(field.id)}
            className="min-h-7 w-full rounded border border-transparent px-1 py-1 text-left text-[13px] text-text hover:border-line hover:bg-hover"
          >
            {customFieldDisplay(field, value, task, users, customValues, customFields)}
          </button>
          {referenceOpen === field.id && (
            <ReferencePicker
              field={field}
              initial={customValueToIdArray(value)}
              onCancel={() => setReferenceOpen(null)}
              onSave={(ids) => {
                setReferenceOpen(null);
                void setCustomValue(field.id, ids);
              }}
            />
          )}
        </div>
      );
    }
    if (field.field_type === "people") {
      const selected = customValueToIdArray(value);
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-1" key={`cf-${task.id}-${field.id}`}>
          {users.length === 0 ? (
            <span className="text-[12px] text-muted">メンバーがいません</span>
          ) : (
            users.map((user) => (
              <label key={user.id} className="flex cursor-pointer items-center gap-1 text-[12px] text-text">
                <input
                  type="checkbox"
                  checked={selected.includes(user.id)}
                  onChange={(event) =>
                    setCustomValue(
                      field.id,
                      event.target.checked
                        ? [...selected, user.id]
                        : selected.filter((id) => id !== user.id),
                    )
                  }
                />
                {user.name}
              </label>
            ))
          )}
        </div>
      );
    }
    if (field.field_type === "number") {
      return (
        <TaskDraftInput
          key={customFieldInputKey(task.id, field.id, reloadRevision)}
          taskId={task.id}
          field={`custom-${field.id}`}
          value={customValueToInput(field, value)}
          updatedAt={updatedAt}
          recovery={null}
          onSave={(input, stamp) => setCustomValue(field.id, input === "" ? null : Number(input), stamp)}
          label={field.name}
          type="number"
          className="h-7 w-24 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field"
        />
      );
    }
    if (field.field_type === "date") {
      return (
        <TaskDraftInput
          key={customFieldInputKey(task.id, field.id, reloadRevision)}
          taskId={task.id}
          field={`custom-${field.id}`}
          value={customValueToInput(field, value)}
          updatedAt={updatedAt}
          recovery={null}
          onSave={(input, stamp) => setCustomValue(field.id, input || null, stamp)}
          label={field.name}
          type="date"
          className="h-7 w-40 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field"
        />
      );
    }
    if (field.field_type === "multi_select") {
      const selected = customValueToArray(value);
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-1" key={`cf-${task.id}-${field.id}`}>
          {field.options.length === 0 ? (
            <span className="text-[12px] text-muted">選択肢がありません</span>
          ) : (
            field.options.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-1 text-[12px] text-text">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(event) =>
                    setCustomValue(
                      field.id,
                      event.target.checked
                        ? [...selected, option]
                        : selected.filter((value) => value !== option),
                    )
                  }
                />
                {option}
              </label>
            ))
          )}
        </div>
      );
    }
    if (field.field_type === "select") {
      // Immediate-save selects keep remounting on server changes; buffered
      // text/number/date drafts below must not.
      return (
        <select
          defaultValue={customValueToInput(field, value)}
          key={`cf-select-${task.id}-${field.id}-${customValueToInput(field, value)}`}
          onChange={(event) => setCustomValue(field.id, event.target.value === "" ? null : event.target.value)}
          className="h-7 max-w-[220px] cursor-pointer rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field"
        >
          <option value="">–</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    return (
      <TaskDraftInput
        key={customFieldInputKey(task.id, field.id, reloadRevision)}
        taskId={task.id}
        field={`custom-${field.id}`}
        value={customValueToInput(field, value)}
        updatedAt={updatedAt}
        recovery={null}
        onSave={(input, stamp) => setCustomValue(field.id, input === "" ? null : input, stamp)}
        label={field.name}
        className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field"
      />
    );
  };

  const collaboratorList = (() => {
    const map = new Map<number, { id: number; name: string; avatar_url?: string | null }>();
    const add = (id: number | null, name: string | null | undefined) => {
      if (id === null || !name) return;
      map.set(id, { id, name, avatar_url: users.find((user) => user.id === id)?.avatar_url ?? null });
    };
    add(task.assignee_id, userName(task.assignee_id));
    add(task.created_by, task.creator_name ?? null);
    for (const comment of comments) add(comment.author_id, comment.author_name);
    return [...map.values()];
  })();

  const assignee = users.find((user) => user.id === task.assignee_id);
  const statusChoices = statusOptions.includes(task.status)
    ? statusOptions
    : [task.status, ...statusOptions];
  const today = todayISO();
  const stateSummary = taskStateSummary(task, today);
  const lateDays = stateSummary.state === "overdue" ? overdueDays(task.due_on, today) : 0;
  const paneShellClass = `taskpane-enter @container flex w-full shrink-0 flex-col overflow-hidden bg-surface-subtle ${
    maximized
      ? "fixed inset-0 z-[120]"
      : "fixed inset-0 z-[80] md:sticky md:top-0 md:z-auto md:h-[100dvh] md:w-[560px] md:self-start md:border-l md:border-line xl:w-[680px] 2xl:w-[760px]"
  }`;
  const draftProjectName = memberships.find((membership) => membership.id === projectId)?.name ?? "";
  const conflictRows = conflict ? taskConflictComparisonRows({
    attempted: conflict.attempted,
    current: conflict.current,
    customField: conflict.customField,
    labels: FIELD_LABELS,
    describeValue,
    users,
    task,
    customValues,
    customFields,
  }) : [];

  if (draftActive && paneDraft && quick) {
    return (
      <aside
        ref={paneRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="タスク詳細"
        data-task-pane
        data-task-pane-draft
        className={paneShellClass}
      >
        <div className="flex min-h-8 shrink-0 items-center gap-1 px-5 pt-4 md:px-[26px] md:pt-[18px]">
          <span data-task-state-summary className="shrink-0 whitespace-nowrap text-[12px] text-muted">
            新規タスク
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setMaximized((value) => !value)}
            title={maximized ? "全画面を終了" : "フルスクリーン"}
            aria-label={maximized ? "全画面を終了" : "フルスクリーン"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
          >
            {maximized ? (
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
              </svg>
            )}
          </button>
          <Link
            href={closeHref}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
            title="詳細を閉じる"
            aria-label="詳細を閉じる"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 3l10 10M13 3 3 13" />
            </svg>
          </Link>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-task-pane-scroll>
          <div className="px-5 pb-10 pt-4 md:px-[26px] md:pt-[18px]" data-task-pane-content data-draft-pane>
            <p role="status" className="mb-3 rounded-md border border-line-subtle bg-surface p-2 text-[12px] text-secondary">
              タスク名を確定すると、担当者・期日・説明を編集できます。
            </p>
            <input
              value={paneDraft.text}
              onChange={(event) => quick.change(paneDraft, event.target.value)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Element && next.closest("[data-quick-task]")) return;
                void quick.finish(paneDraft);
              }}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return;
                if (event.key === "Enter") { event.preventDefault(); void quick.finish(paneDraft); }
                if (event.key === "Escape") { event.preventDefault(); quick.cancel(paneDraft); }
              }}
              readOnly={paneDraft.saving}
              aria-busy={paneDraft.saving}
              aria-label="タスク名"
              placeholder="タスク名を入力"
              maxLength={1000}
              data-draft-pane-name
              className="w-full border-b border-transparent bg-transparent pb-1 text-[20px] font-bold leading-[1.4] text-text outline-none placeholder:text-subtle focus:border-accent"
            />
            {paneDraft.error && (
              <p role="alert" className="mt-2 rounded border border-danger-line bg-surface p-2 text-xs text-danger">
                {paneDraft.error}
              </p>
            )}

            <fieldset disabled className="mt-5 flex min-w-0 flex-col gap-3 border-0 p-0" data-task-fields data-draft-pane-fields>
              <TaskFieldRow label="担当者">
                <button type="button" disabled className="flex h-7 min-w-0 max-w-full items-center gap-2 rounded px-0.5 text-[13px] text-subtle">
                  <EmptyCellIcon kind="assignee" />
                  <span className="truncate">未割り当て</span>
                </button>
              </TaskFieldRow>
              <TaskFieldRow label="期日">
                <button type="button" disabled className="flex h-7 min-w-0 items-center gap-2 rounded px-0.5 text-[13px] text-subtle">
                  <EmptyCellIcon kind="due" />
                  <span className="truncate">期日なし</span>
                </button>
              </TaskFieldRow>
              <TaskFieldRow label="プロジェクト">
                <span className="flex min-h-7 items-center truncate text-[13px] text-secondary">{draftProjectName}</span>
              </TaskFieldRow>
              <TaskFieldRow label="説明">
                <span className="flex min-h-7 items-center text-[13px] text-subtle">タスク名の確定後に編集できます</span>
              </TaskFieldRow>
            </fieldset>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={paneRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="タスク詳細"
      data-task-pane
      className={paneShellClass}
    >
      <TaskPaneHeader
        task={{ ...task, approval }}
        collaborators={collaboratorList}
        showTitle={showTitle}
        closeHref={closeHref}
        maximized={maximized}
        stateText={stateSummary.text}
        overdueDays={lateDays}
        overdueText={lateDays > 0 ? overdueBadgeText(lateDays) : null}
        onToggle={toggle}
        onRemove={remove}
        onShare={() => void shareTask()}
        onCopyLink={() => void copyTaskLink()}
        onToggleFullscreen={() => setMaximized((value) => !value)}
        onOpenApproval={() => setApprovalOpenSignal((value) => value + 1)}
        canEdit={canEdit && !reloading}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setShowTitle(event.currentTarget.scrollTop > 28)}
        data-task-pane-scroll
      >
        <TaskVisibilityBanner onShare={() => void shareTask()} />

        <div className="px-5 pb-10 pt-4 md:px-[26px] md:pt-[18px]" data-task-pane-content>
          <TaskSaveStatus states={saveStates} reloading={reloading} onReload={reloadTask} />
          {!canEdit && <p role="status" data-task-readonly className="mb-2 text-[12px] text-secondary">タスクの項目は閲覧のみです。変更には編集権限が必要です。</p>}
          {conflict && (
            <div className="mb-3 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm">
              <div className="font-semibold text-danger">他のユーザーが先に更新しました</div>
              <div className="mt-1 space-y-0.5">
                {conflictRows.map((row) => (
                  <div key={row.key}>
                    {row.label}: {row.attempted} → {row.current}（現在値）
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {conflictRows.length > 0 && (
                  <button
                    onClick={retryOverwrite}
                    className="rounded bg-danger-strong px-3 py-1 text-on-strong hover:bg-danger-strong-hover"
                  >
                    最新で上書きする
                  </button>
                )}
                <button
                  onClick={discardConflict}
                  data-task-conflict-discard
                  className="rounded border px-3 py-1 hover:bg-hover"
                >
                  破棄して最新表示
                </button>
              </div>
            </div>
          )}

          <TaskDraftInput
            taskId={task.id}
            field="name"
            value={task.name}
            updatedAt={updatedAt}
            recovery={inputRecovery}
            readOnly={!canEdit || reloading}
            label="タスク名"
            onSave={(value, stamp) => { if (value.trim()) return patch({ name: value.trim() }, stamp); }}
            normalize={(value) => value.trim()}
            enterBlurs
            className="w-full border-b border-transparent bg-transparent pb-1 text-[20px] font-bold leading-[1.4] text-text outline-none placeholder:text-subtle focus:border-accent"
            placeholder="タスク名を入力"
          />

          {task.is_milestone && (
            <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-success">
              <TaskMilestoneIcon />
              マイルストーン
            </div>
          )}

          <TaskApprovalSection key={task.id} task={task} viewerId={viewerId} canEdit={canEdit}
            openSignal={approvalOpenSignal} onSummaryChange={(value) => setApprovalOverride({ taskId: task.id, stamp: task.updated_at, approval: value })} onChanged={refresh} />

          <fieldset disabled={!canEdit || reloading} className="mt-5 flex min-w-0 flex-col gap-3 border-0 p-0" data-task-fields>
            <TaskFieldRow label="担当者">
              {assigneeEditing ? (
                <div className="min-w-0">
                  <AssigneePicker
                    users={users}
                    currentId={task.assignee_id}
                    onPick={(id) => {
                      setAssigneeEditing(false);
                      void patch({ assignee_id: id });
                    }}
                    onCancel={() => setAssigneeEditing(false)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAssigneeEditing(true)}
                  aria-label="担当者を設定"
                  className="flex h-7 min-w-0 max-w-full items-center gap-2 rounded px-0.5 text-[13px] text-text hover:bg-hover"
                >
                  {assignee ? (
                    <TaskAvatar name={assignee.name} url={assignee.avatar_url} className="h-5 w-5" textClassName="text-[9px]" />
                  ) : (
                    <EmptyCellIcon kind="assignee" />
                  )}
                  <span className="truncate">{assignee?.name ?? "未割り当て"}</span>
                  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="m3.5 6 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </TaskFieldRow>

            <TaskFieldRow label="期日">
              <TaskDueDateField
                key={`dates-${task.id}-${reloadRevision}`}
                start={task.start_on}
                due={task.due_on}
                overdue={isOverdue}
                onPatch={patch}
              />
            </TaskFieldRow>

            <TaskDependenciesSection
              key={`dependencies-${task.id}-${reloadRevision}`}
              projectId={projectId}
              view={view}
              taskId={task.id}
              dependencies={dependencies}
              taskOptions={taskOptions}
              draft={depDraft}
              onDraftChange={setDepDraft}
              onAdd={addDependency}
              onRemove={removeDependency}
            />

            <TaskFieldRow label="プロジェクト">
              <div className="min-w-0 text-text">
                {memberships.map((membership) => {
                  const isPrimary = membership.id === task.project_id;
                  return (
                    <div key={membership.id} className="flex min-h-7 items-center gap-1.5 text-[13px]">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent-soft text-accent-text">
                        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                          <path d="M3 13V3h10v10zM3 6h10M6 6v7" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {membership.name}
                        {membership.section_name ? ` / ${membership.section_name}` : ""}
                      </span>
                      {isPrimary ? (
                        <span className="shrink-0 text-[10px] text-muted">主</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeMembership(membership.id)}
                          className="shrink-0 rounded px-1 text-[12px] text-muted hover:bg-hover hover:text-danger"
                          title="所属を外す"
                          aria-label={`${membership.name} から外す`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
                {!addingProject ? (
                  <button
                    type="button"
                    onClick={openAddProject}
                    className="flex h-7 items-center gap-1 rounded px-0.5 text-[12px] text-muted hover:bg-hover hover:text-secondary"
                  >
                    <span className="text-sm leading-none">＋</span>
                    プロジェクトを追加
                  </button>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    <select
                      value={newMemberProject}
                      onChange={(event) => onPickMemberProject(event.target.value)}
                      className="h-8 rounded border border-field-line px-2 text-[12px] outline-none focus:border-accent"
                      aria-label="プロジェクトを選択"
                    >
                      <option value="">プロジェクトを選択</option>
                      {allProjects
                        .filter((project) => !memberships.some((membership) => membership.id === project.id))
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                    {newMemberProject && (
                      <div className="flex gap-1">
                        <select
                          value={newMemberSection}
                          onChange={(event) => setNewMemberSection(event.target.value)}
                          className="h-8 min-w-0 flex-1 rounded border border-field-line px-2 text-[12px] outline-none focus:border-accent"
                          aria-label="セクションを選択"
                        >
                          <option value="">セクションなし</option>
                          {newMemberSections.map((section) => (
                            <option key={section.id} value={section.id}>
                              {section.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={addMembership}
                          className="shrink-0 rounded bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
                        >
                          追加
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={closeAddProject}
                      className="self-start rounded px-1 py-0.5 text-[11px] text-muted hover:bg-hover"
                    >
                      キャンセル
                    </button>
                  </div>
                )}
              </div>
            </TaskFieldRow>

            {statusFieldEnabled ? (
              <TaskFieldRow label={statusFieldName}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-task-status-row>
                  {canEdit ? <details className="relative inline-block">
                    <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                      <TaskStatusChip status={task.status} />
                    </summary>
                    <div className="absolute left-0 top-full z-[130] mt-1 w-44 rounded-lg border border-line bg-surface p-1 text-[12px] shadow-xl">
                      {statusChoices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          onClick={(event) => {
                            patch({ status: choice });
                            event.currentTarget.closest("details")?.removeAttribute("open");
                          }}
                          className={`flex w-full items-center rounded px-2 py-1 text-left hover:bg-hover ${
                            choice === task.status ? "font-semibold text-text" : "text-secondary"
                          }`}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  </details> : <TaskStatusChip status={task.status} />}
                  <span aria-hidden="true" className="text-muted">・</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex items-center gap-0.5">
                      <TaskDraftInput
                        taskId={task.id}
                        field="progress"
                        value={task.progress}
                        updatedAt={updatedAt}
                        recovery={inputRecovery}
                        readOnly={!canEdit || reloading}
                        type="number"
                        min={0}
                        max={100}
                        onSave={(value, stamp) => patch({ progress: Math.max(0, Math.min(100, Number(value))) }, stamp)}
                        normalize={(value) => String(Math.max(0, Math.min(100, Number(value))))}
                        label="進捗"
                        className="h-7 w-9 rounded border border-transparent bg-transparent px-1 text-right text-[13px] text-text outline-none [appearance:textfield] hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="text-[10px] text-muted">%</span>
                    </span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-strong">
                      <span className={`block h-full rounded-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${task.progress}%` }} />
                    </span>
                  </div>
                </div>
              </TaskFieldRow>
            ) : (
              <TaskFieldRow label="進捗">
                <div className="flex h-7 min-w-0 items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    <TaskDraftInput
                      taskId={task.id}
                      field="progress"
                      value={task.progress}
                      updatedAt={updatedAt}
                      recovery={inputRecovery}
                      readOnly={!canEdit || reloading}
                      type="number"
                      min={0}
                      max={100}
                      onSave={(value, stamp) => patch({ progress: Math.max(0, Math.min(100, Number(value))) }, stamp)}
                      normalize={(value) => String(Math.max(0, Math.min(100, Number(value))))}
                      label="進捗"
                      className="h-7 w-9 rounded border border-transparent bg-transparent px-1 text-right text-[13px] text-text outline-none [appearance:textfield] hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-[10px] text-muted">%</span>
                  </span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-strong">
                    <span className={`block h-full rounded-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${task.progress}%` }} />
                  </span>
                </div>
              </TaskFieldRow>
            )}

            <TaskFieldRow label="繰り返し">
              <select
                value={task.recurrence ?? "none"}
                onChange={(event) => patch({ recurrence: event.target.value })}
                className="h-7 max-w-[180px] cursor-pointer rounded border border-transparent bg-transparent px-1 text-[13px] text-text outline-none hover:border-field-line-hover hover:bg-field focus:border-accent focus:bg-field"
                aria-label="繰り返し"
              >
                <option value="none">なし</option>
                <option value="daily">毎日</option>
                <option value="weekly">毎週</option>
                <option value="monthly">毎月</option>
              </select>
            </TaskFieldRow>
          </fieldset>

          <TaskCustomFieldsSection key={`fields-${task.id}-${reloadRevision}`} customFields={customFields} renderEditor={renderCustomEditor} />

          <TaskDescriptionSection
            key={`description-${task.id}-${reloadRevision}`}
            doc={task.description_doc ?? null}
            legacy={task.description}
            mentionUsers={mentionUsers}
            onSave={(doc) => patchChecked({ description_doc: doc })}
            canEdit={canEdit && !reloading}
          />

          <TaskSubtasksSection
            canEdit={canEdit && !reloading}
            projectId={projectId}
            view={view}
            subtasks={subtasks}
            adding={addingSubtask}
            draft={subtaskDraft}
            onStartAdd={() => setAddingSubtask(true)}
            onCancelAdd={() => {
              setAddingSubtask(false);
              setSubtaskDraft("");
            }}
            onDraftChange={setSubtaskDraft}
            onAdd={addSubtask}
            onToggle={(subtask) => void toggleSubtaskCompletion(subtask)}
            onDelete={(subtask) => void deleteSubtask(subtask)}
          />

          <TaskAttachmentsSection
            canEdit={canEdit && !reloading}
            attachments={attachments}
            uploading={uploading}
            onUpload={uploadFile}
            onDelete={removeAttachment}
          />

          <TaskFeedSection
            feedTab={feedTab}
            onFeedTab={setFeedTab}
            comments={comments}
            events={events}
            viewerId={viewerId}
            viewerCanModerate={viewerCanModerate}
            onSaveEdit={saveComment}
            onDelete={(commentId) => void deleteComment(commentId)}
            reactionMap={reactionMap}
            quickEmojis={QUICK_REACTIONS}
            onToggleReaction={toggleReaction}
            mentionUsers={mentionUsers}
          />
        </div>
      </div>

      <TaskCommentComposer
        key={`composer-${task.id}`}
        taskId={task.id}
        mentionUsers={mentionUsers}
        onSubmit={addComment}
      />
    </aside>
  );
}
