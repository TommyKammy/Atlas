"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/dates";
import type { HomeStatusProject, HomeStatusUpdate } from "@/lib/home-widgets";
import { PROJECT_STATUS_OPTIONS, statusColorDot } from "@/lib/project-status";
import Dialog from "../../ui/Dialog";
import ProjectIcon from "../../ProjectIcon";
import UserAvatar from "../../UserAvatar";

/** Project status updates with an inline Asana-style composer. */
export default function StatusUpdatesWidget({
  updates,
  projects,
}: {
  updates: HomeStatusUpdate[];
  projects: HomeStatusProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(String(projects[0]?.id ?? ""));
  const [status, setStatus] = useState<string>(PROJECT_STATUS_OPTIONS[0].label);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startComposer = () => {
    setProjectId(String(projects[0]?.id ?? ""));
    setStatus(PROJECT_STATUS_OPTIONS[0].label);
    setBody("");
    setError("");
    setOpen(true);
  };

  const submit = async () => {
    if (busy || projectId === "" || body.trim() === "") return;
    const option =
      PROJECT_STATUS_OPTIONS.find((item) => item.label === status) ?? PROJECT_STATUS_OPTIONS[0];
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}/status-updates`, "POST", {
        body: body.trim(),
        status: option.label,
        status_color: option.color,
      });
      setOpen(false);
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ステータスの投稿に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-1.5">
        <span className="text-[11px] text-subtle">プロジェクトの最新状況</span>
        <span className="flex-1" />
        <button
          type="button"
          data-home-status-update-open
          onClick={startComposer}
          disabled={projects.length === 0}
          className="rounded px-1.5 py-0.5 text-[12px] text-[#2c60b8] hover:bg-[#eff4fd] disabled:text-neutral-300"
        >
          ＋ ステータスを更新
        </button>
      </div>

      <div className="min-h-[170px] flex-1">
        {updates.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-subtle">
              ◉
            </span>
            <p className="text-[12px] text-subtle">まだステータス更新はありません。</p>
            {projects.length > 0 && (
              <button
                type="button"
                onClick={startComposer}
                className="text-[12px] text-accent-text hover:underline"
              >
                最初の更新を投稿
              </button>
            )}
          </div>
        ) : (
          updates.slice(0, 5).map((update) => (
            <div
              key={update.id}
              data-home-status-update={update.id}
              className="border-b border-line-subtle px-4 py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <ProjectIcon
                  id={update.project_id}
                  name={update.project_name}
                  color={update.project_color}
                  icon={update.project_icon}
                  className="h-5 w-5 text-[9px]"
                />
                <Link
                  href={`/projects/${update.project_id}?view=overview`}
                  className="min-w-0 truncate text-[12px] font-medium text-text hover:underline"
                >
                  {update.project_name}
                </Link>
                {update.status && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted">
                    <span className={`h-2 w-2 rounded-full ${statusColorDot(update.status_color)}`} />
                    {update.status}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-subtle">
                  {formatDateTime(update.created_at)}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 text-secondary">
                {update.body}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-subtle">
                <UserAvatar
                  name={update.author_name}
                  url={update.author_avatar_url}
                  className="h-4 w-4"
                  textClassName="text-[8px]"
                />
                {update.author_name ?? "不明なユーザー"}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="プロジェクトのステータスを更新"
        titleId="home-status-update-title"
      >
        <div className="p-5">
          <h2 id="home-status-update-title" className="text-[15px] font-semibold text-text">
            プロジェクトのステータスを更新
          </h2>
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] text-muted">
              プロジェクト
              <select
                data-home-status-project
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-muted">
              ステータス
              <select
                data-home-status-value
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              >
                {PROJECT_STATUS_OPTIONS.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-muted">
              更新内容
              <textarea
                data-home-status-body
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                placeholder="プロジェクトの進捗、リスク、次のアクションを共有"
                className="mt-1 w-full resize-y rounded border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
            </label>
            {error !== "" && <p className="text-[12px] text-danger">{error}</p>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-secondary hover:bg-neutral-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              data-home-status-submit
              disabled={busy || body.trim() === "" || projectId === ""}
              onClick={() => void submit()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
            >
              {busy ? "投稿中…" : "投稿"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
