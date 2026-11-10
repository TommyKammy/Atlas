"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Attachment, CommentRow, TaskRow, User } from "@/lib/data";
import {
  customFieldDisplay,
  customValueToArray,
  customValueToIdArray,
  customValueToInput,
  isReadOnlyFieldType,
  type CustomField,
  type CustomValue,
} from "@/lib/custom-fields";
import { useFocusTrap } from "@/lib/use-focus-trap";
import TaskPaneHeader from "./task/TaskPaneHeader";
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
import type { TaskApprovalSummary } from "@/lib/task-approval";
import { QUICK_REACTIONS, useTaskPane } from "@/lib/use-task-pane";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-start gap-2 rounded-md px-1 py-1 hover:bg-neutral-50">
      <span className="w-[88px] shrink-0 truncate pt-1.5 text-[12px] text-neutral-500" title={label}>
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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
  events: { id: number; summary: string; actor_name: string | null; created_at: string }[];
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
    setConflict,
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
    patch,
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
  const [approvalOverride, setApprovalOverride] = useState<{ taskId: number; stamp: string; approval: TaskApprovalSummary | null } | null>(null);
  const [approvalOpenSignal, setApprovalOpenSignal] = useState(0);
  const approval = approvalOverride?.taskId === task.id && approvalOverride.stamp === task.updated_at ? approvalOverride.approval : task.approval;
  useFocusTrap(paneRef, true, () => router.push(closeHref));

  const renderCustomEditor = (field: CustomField) => {
    const value = customValues[field.id];
    if (isReadOnlyFieldType(field.field_type) || !canEditField(field)) {
      return (
        <div
          key={`cf-${task.id}-${field.id}`}
          className="min-h-7 py-1 text-[13px] text-neutral-700"
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
            className="min-h-7 w-full rounded border border-transparent px-1 py-1 text-left text-[13px] text-neutral-700 hover:border-neutral-200 hover:bg-white"
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
            <span className="text-[12px] text-neutral-400">メンバーがいません</span>
          ) : (
            users.map((user) => (
              <label key={user.id} className="flex cursor-pointer items-center gap-1 text-[12px] text-neutral-600">
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
        <input
          type="number"
          defaultValue={customValueToInput(field, value)}
          key={`cf-${task.id}-${field.id}`}
          onBlur={(event) =>
            setCustomValue(field.id, event.target.value === "" ? null : Number(event.target.value))
          }
          className="h-7 w-24 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
        />
      );
    }
    if (field.field_type === "date") {
      return (
        <input
          type="date"
          defaultValue={value?.value_date ?? ""}
          key={`cf-${task.id}-${field.id}`}
          onBlur={(event) => setCustomValue(field.id, event.target.value || null)}
          className="h-7 w-40 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
        />
      );
    }
    if (field.field_type === "multi_select") {
      const selected = customValueToArray(value);
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-1" key={`cf-${task.id}-${field.id}`}>
          {field.options.length === 0 ? (
            <span className="text-[12px] text-neutral-400">選択肢がありません</span>
          ) : (
            field.options.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-1 text-[12px] text-neutral-600">
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
      return (
        <select
          defaultValue={customValueToInput(field, value)}
          key={`cf-${task.id}-${field.id}`}
          onChange={(event) => setCustomValue(field.id, event.target.value === "" ? null : event.target.value)}
          className="h-7 max-w-[220px] cursor-pointer rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
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
      <input
        defaultValue={customValueToInput(field, value)}
        key={`cf-${task.id}-${field.id}`}
        onBlur={(event) => setCustomValue(field.id, event.target.value === "" ? null : event.target.value)}
        className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
      />
    );
  };

  const removeDependency = async (dependencyId: number) => {
    await fetch(`/api/dependencies?task_id=${task.id}&depends_on_id=${dependencyId}`, { method: "DELETE" });
    refresh();
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

  return (
    <aside
      ref={paneRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="タスク詳細"
      data-task-pane
      className={`taskpane-enter flex w-full shrink-0 flex-col overflow-hidden border-t bg-white ${
        maximized
          ? "fixed inset-0 z-[120]"
          : "fixed inset-0 z-[80] md:sticky md:top-0 md:z-auto md:h-[calc(100dvh-3rem)] md:w-[560px] md:self-start md:border-l md:border-t-0 xl:w-[680px] 2xl:w-[760px]"
      }`}
    >
      <TaskPaneHeader
        task={{ ...task, approval }}
        collaborators={collaboratorList}
        showTitle={showTitle}
        closeHref={closeHref}
        maximized={maximized}
        onToggle={toggle}
        onRemove={remove}
        onShare={() => void shareTask()}
        onCopyLink={() => void copyTaskLink()}
        onToggleFullscreen={() => setMaximized((value) => !value)}
        onOpenApproval={() => setApprovalOpenSignal((value) => value + 1)}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setShowTitle(event.currentTarget.scrollTop > 28)}
        data-task-pane-scroll
      >
        <TaskVisibilityBanner onShare={() => void shareTask()} />

        <div className="px-4 pb-8 pt-3">
          {conflict && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
              <div className="font-semibold text-red-700">他のユーザーが先に更新しました</div>
              <div className="mt-1 space-y-0.5">
                {Object.keys(conflict.attempted)
                  .filter((key) => key in FIELD_LABELS)
                  .map((key) => (
                    <div key={key}>
                      {FIELD_LABELS[key]}: {describeValue(key, conflict.attempted[key])} →{" "}
                      {key === "assignee_id"
                        ? ((conflict.current.assignee_name as string) ?? "–")
                        : describeValue(key, conflict.current[key])}
                      （現在値）
                    </div>
                  ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={retryOverwrite}
                  className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                >
                  最新で上書きする
                </button>
                <button
                  onClick={() => {
                    setConflict(null);
                    refresh();
                  }}
                  className="rounded border px-3 py-1 hover:bg-white"
                >
                  破棄して最新表示
                </button>
              </div>
            </div>
          )}

          <input
            defaultValue={task.name}
            key={`name-${task.id}`}
            aria-label="タスク名"
            onBlur={(event) =>
              event.target.value.trim() &&
              event.target.value !== task.name &&
              patch({ name: event.target.value.trim() })
            }
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            className="w-full border-b border-transparent bg-transparent pb-1 text-[24px] font-semibold leading-8 tracking-[-0.01em] text-neutral-900 outline-none placeholder:text-neutral-300 focus:border-[#4075cf]"
            placeholder="タスク名を入力"
          />

          {task.is_milestone && (
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[#2f7d43]">
              <TaskMilestoneIcon />
              マイルストーン
            </div>
          )}

          <TaskApprovalSection key={task.id} task={task} viewerId={viewerId} canEdit={canEdit}
            openSignal={approvalOpenSignal} onSummaryChange={(value) => setApprovalOverride({ taskId: task.id, stamp: task.updated_at, approval: value })} onChanged={refresh} />

          <div className="mt-2 space-y-0.5" data-task-fields>
            <FieldRow label="担当者">
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
                  className="flex h-7 min-w-0 max-w-full items-center gap-2 rounded px-1 text-[13px] text-neutral-800 hover:bg-neutral-100"
                >
                  {assignee ? (
                    <TaskAvatar name={assignee.name} url={assignee.avatar_url} className="h-5 w-5" textClassName="text-[9px]" />
                  ) : (
                    <EmptyCellIcon kind="assignee" />
                  )}
                  <span className="truncate">{assignee?.name ?? "未割り当て"}</span>
                  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="m3.5 6 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </FieldRow>

            <FieldRow label="期日">
              <TaskDueDateField
                start={task.start_on}
                due={task.due_on}
                overdue={isOverdue}
                onPatch={patch}
              />
            </FieldRow>

            <TaskDependenciesSection
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

            <FieldRow label="プロジェクト">
              <div className="min-w-0 text-neutral-800">
                {memberships.map((membership) => {
                  const isPrimary = membership.id === task.project_id;
                  return (
                    <div key={membership.id} className="flex min-h-7 items-center gap-1.5 text-[13px]">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#e8eef8] text-[#38506e]">
                        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                          <path d="M3 13V3h10v10zM3 6h10M6 6v7" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {membership.name}
                        {membership.section_name ? ` / ${membership.section_name}` : ""}
                      </span>
                      {isPrimary ? (
                        <span className="shrink-0 text-[10px] text-neutral-400">主</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeMembership(membership.id)}
                          className="shrink-0 rounded px-1 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
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
                    className="flex h-7 items-center gap-1 rounded px-1 text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <span className="text-sm leading-none">＋</span>
                    プロジェクトを追加
                  </button>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    <select
                      value={newMemberProject}
                      onChange={(event) => onPickMemberProject(event.target.value)}
                      className="h-8 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
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
                          className="h-8 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
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
                          className="shrink-0 rounded bg-[#2f6fd0] px-3 text-[12px] font-medium text-white hover:bg-[#2459ad]"
                        >
                          追加
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={closeAddProject}
                      className="self-start rounded px-1 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100"
                    >
                      キャンセル
                    </button>
                  </div>
                )}
              </div>
            </FieldRow>

            <FieldRow label="進捗">
              <div className="flex h-7 items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={task.progress}
                  key={`progress-${task.id}`}
                  onBlur={(event) =>
                    patch({ progress: Math.max(0, Math.min(100, Number(event.target.value))) })
                  }
                  aria-label="進捗"
                  className="h-7 w-12 rounded border border-transparent bg-transparent px-1 text-[13px] text-neutral-800 outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
                />
                <span className="text-[10px] text-neutral-400">%</span>
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-200">
                  <span className="block h-full rounded-full bg-green-500" style={{ width: `${task.progress}%` }} />
                </span>
              </div>
            </FieldRow>

            {statusFieldEnabled && (
              <FieldRow label={statusFieldName}>
                <details className="relative inline-block">
                  <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                    <TaskStatusChip status={task.status} />
                  </summary>
                  <div className="absolute left-0 top-full z-[130] mt-1 w-44 rounded-lg border border-neutral-200 bg-white p-1 text-[12px] shadow-xl">
                    {statusChoices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        onClick={(event) => {
                          patch({ status: choice });
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                        className={`flex w-full items-center rounded px-2 py-1 text-left hover:bg-neutral-100 ${
                          choice === task.status ? "font-semibold text-neutral-900" : "text-neutral-700"
                        }`}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                </details>
              </FieldRow>
            )}

            <FieldRow label="繰り返し">
              <select
                value={task.recurrence ?? "none"}
                onChange={(event) => patch({ recurrence: event.target.value })}
                className="h-7 max-w-[180px] cursor-pointer rounded border border-transparent bg-transparent px-1 text-[13px] text-neutral-800 outline-none hover:border-neutral-200 hover:bg-white focus:border-[#4075cf] focus:bg-white"
                aria-label="繰り返し"
              >
                <option value="none">なし</option>
                <option value="daily">毎日</option>
                <option value="weekly">毎週</option>
                <option value="monthly">毎月</option>
              </select>
            </FieldRow>
          </div>

          <TaskCustomFieldsSection customFields={customFields} renderEditor={renderCustomEditor} />

          <TaskDescriptionSection
            key={`description-${task.id}`}
            doc={task.description_doc ?? null}
            legacy={task.description}
            mentionUsers={mentionUsers}
            onSave={(doc) => patch({ description_doc: doc })}
          />

          <TaskSubtasksSection
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
