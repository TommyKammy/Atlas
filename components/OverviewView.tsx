import Link from "next/link";
import type { ProjectActivity, ProjectStats } from "@/lib/data";
import ImportForm from "./ImportForm";
import { SectionProgress, StatCards, UpcomingList } from "./Stats";
import ShareLinks from "./ShareLinks";
import ProjectDescriptionEditor from "./ProjectDescriptionEditor";
import ProjectStatusQuick from "./ProjectStatusQuick";
import ProjectShareButton from "./ProjectShareButton";

// Asana overview layout (measured 2026-11-06, read-only):
// status hero → quick-action cards → activity → プロジェクトでの役割.
export default function OverviewView({
  projectId,
  stats,
  members,
  projectStatus,
  projectStatusColor,
  projectName,
  description,
  activity,
  canEdit,
}: {
  projectId: number;
  stats: ProjectStats;
  members: { id: number; name: string; role: string | null }[];
  projectStatus: string | null;
  projectStatusColor?: string | null;
  projectName: string;
  description: string;
  activity: ProjectActivity[];
  canEdit: boolean;
}) {
  const owner = members.find((m) => m.role === "admin") ?? members[0];
  const others = members.filter((m) => m.id !== owner?.id);
  return (
    <div className="max-w-4xl px-4 pb-16">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <span className="text-sm text-neutral-500">プロジェクトのステータスは？</span>
        <span className="flex-1" />
        <details className="relative">
          <summary className="flex h-7 cursor-pointer list-none items-center rounded-md border bg-white px-2 text-[13px] text-neutral-700 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
            ⋯ オプション
          </summary>
          <div className="absolute right-0 z-30 mt-1 flex w-64 flex-col gap-1 rounded-lg border bg-white p-3 text-sm shadow-lg">
            <span className="text-neutral-500">エクスポート</span>
            <a href={`/api/projects/${projectId}/export?format=json`} className="text-blue-700 hover:underline">
              JSON
            </a>
            <a href={`/api/projects/${projectId}/export?format=csv`} className="text-blue-700 hover:underline">
              CSV
            </a>
            <span className="mt-1 text-neutral-500">インポート</span>
            <ImportForm projectId={projectId} />
            <span className="mt-1 text-neutral-500">共有リンク</span>
            <ShareLinks projectId={projectId} />
          </div>
        </details>
      </div>
      <div data-overview-hero className="rounded-lg border p-4">
        <div className="text-sm font-semibold">プロジェクトのステータスは？</div>
        <ProjectStatusQuick
          projectId={projectId}
          initialStatus={projectStatus}
          initialColor={projectStatusColor ?? "none"}
          canEdit={canEdit}
        />
        {!projectStatus || projectStatus === "active" ? (
          <div className="mt-1 text-[12px] text-neutral-500">
            進捗を共有すると、メンバーは最新情報を概要から確認できます。
          </div>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={`/projects/${projectId}?view=messages`}
          className="rounded-lg border p-3 text-sm hover:bg-neutral-50"
        >
          <div className="font-semibold text-neutral-800">このプロジェクトの最新情報を確認</div>
          <div className="mt-0.5 text-xs text-neutral-500">メッセージをチェックして状況を共有します</div>
        </Link>
        <Link
          href={`/projects/${projectId}?view=messages&focus=composer`}
          className="rounded-lg border p-3 text-sm hover:bg-neutral-50"
        >
          <div className="font-semibold text-neutral-800">メンバーにメッセージを送信</div>
          <div className="mt-0.5 text-xs text-neutral-500">プロジェクト全体への連絡を作成します</div>
        </Link>
        <Link
          href={`/projects/${projectId}?view=dashboard`}
          className="rounded-lg border p-3 text-sm hover:bg-neutral-50"
        >
          <div className="font-semibold text-neutral-800">このプロジェクトの潜在的なリスクを事前に把握</div>
          <div className="mt-0.5 text-xs text-neutral-500">期限超過と進捗をダッシュボードで確認します</div>
        </Link>
        <Link
          href={`/projects/${projectId}?view=dashboard`}
          className="rounded-lg border p-3 text-sm hover:bg-neutral-50"
        >
          <div className="font-semibold text-neutral-800">サマリーを確認</div>
          <div className="mt-0.5 text-xs text-neutral-500">完了トレンドと担当者別の状況を確認します</div>
        </Link>
      </div>
      <ProjectDescriptionEditor projectId={projectId} initial={description} canEdit={canEdit} />

      <div className="mt-6" id="roles">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">プロジェクトでの役割</h2>
          <ProjectShareButton projectId={projectId} projectName={projectName} label="＋ メンバーを追加" />
        </div>
        <div className="mt-2 space-y-1">
          {owner && (
            <div className="flex items-center gap-2 py-1 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400 text-xs font-bold text-neutral-900">
                {owner.name.slice(0, 1)}
              </span>
              <span className="font-medium">{owner.name}</span>
              <span className="text-xs text-neutral-500">プロジェクトオーナー</span>
            </div>
          )}
          {others.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400 text-xs font-bold text-neutral-900">
                {m.name.slice(0, 1)}
              </span>
              <span className="font-medium">{m.name}</span>
              <span className="text-xs text-neutral-500">メンバー</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6">
        <StatCards stats={stats} />
      </div>
      <SectionProgress projectId={projectId} view="list" stats={stats} />
      <UpcomingList projectId={projectId} stats={stats} />
      <div className="mt-6" data-project-activity>
        <h2 className="font-semibold">最近のアクティビティ</h2>
        {activity.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">まだアクティビティはありません。</p>
        ) : (
          <div className="mt-1 space-y-2">
            {activity.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                data-project-activity-item={`${item.kind}-${item.id}`}
                className="flex gap-2 border-b py-2 text-sm"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-700">
                  {(item.actor_name ?? "?").slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-neutral-800">{item.summary}</div>
                  <div className="text-[11px] text-neutral-500">
                    {item.actor_name ?? "–"} ・ {item.created_at.slice(0, 16)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
