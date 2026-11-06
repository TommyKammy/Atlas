import Link from "next/link";
import type { ProjectStats } from "@/lib/data";
import ImportForm from "./ImportForm";
import { SectionProgress, StatCards, UpcomingList } from "./Stats";
import ShareLinks from "./ShareLinks";

// Asana overview layout (measured 2026-11-06, read-only):
// status hero → quick-action cards → activity → プロジェクトでの役割.
export default function OverviewView({
  projectId,
  stats,
  members,
  projectStatus,
}: {
  projectId: number;
  stats: ProjectStats;
  members: { id: number; name: string; role: string | null }[];
  projectStatus: string | null;
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
      {projectStatus ? (
        <div className="rounded-lg border p-4">
          <div className="text-xs text-neutral-500">現在のステータス</div>
          <div className="mt-1 text-lg font-semibold">{projectStatus}</div>
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          <div className="text-sm font-semibold">プロジェクトのステータスを設定しましょう</div>
          <div className="mt-1 text-sm text-neutral-500">
            進捗を共有すると、メンバーは最新情報を概要から確認できます。
          </div>
        </div>
      )}
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
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-700">プロジェクトでの役割</h2>
        <div className="mt-2 space-y-1">
          {owner && (
            <div className="flex items-center gap-2 py-1 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400 text-xs font-bold text-white">
                {owner.name.slice(0, 1)}
              </span>
              <span className="font-medium">{owner.name}</span>
              <span className="text-xs text-neutral-500">プロジェクトオーナー</span>
            </div>
          )}
          {others.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-400 text-xs font-bold text-white">
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
      <div className="mt-6">
        <h2 className="font-semibold">最近の更新</h2>
        <div className="mt-1">
          {stats.recent.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="shrink-0 text-xs text-neutral-400">{t.updated_at}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
