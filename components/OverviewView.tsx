import Link from "next/link";
import ProjectPartnerWorkspace from "./project/ProjectPartner";
import type { ProjectActivity, ProjectStats } from "@/lib/data";
import ImportForm from "./ImportForm";
import { StatCards } from "./Stats";
import ShareLinks from "./ShareLinks";
import ProjectDescriptionEditor from "./ProjectDescriptionEditor";
import ProjectStatusQuick from "./ProjectStatusQuick";
import ProjectShareButton from "./ProjectShareButton";

const link = "rounded text-sm text-[#24529c] hover:underline focus-visible:outline-2 focus-visible:outline-blue-600";
const day = (value: string | null) => value ? value.replaceAll("-", "/") : "未設定";
export default function OverviewView({ projectId, stats, members, projectStatus, projectStatusColor, projectName, description, activity, canEdit, ownerId, dueOn, milestones }: {
  projectId: number; stats: ProjectStats; members: { id: number; name: string; role: string | null }[];
  projectStatus: string | null; projectStatusColor?: string | null; projectName: string; description: string; activity: ProjectActivity[]; canEdit: boolean;
  ownerId: number | null; dueOn: string | null; milestones: { id: number; name: string; due_on: string | null; completed: boolean }[];
}) {
  const owner = members.find(m => m.id === ownerId), progress = stats.total ? Math.round(stats.done / stats.total * 100) : 0;
  const memberAvatar = (name: string) => <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-[#24529c]">{name.slice(0, 1)}</span>;
  return <ProjectPartnerWorkspace key={projectId} projectId={projectId} canEdit={canEdit}>
    <div data-overview-hero className="min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <details className="relative">
          <summary className="cursor-pointer rounded-md px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 focus-visible:outline-blue-600">ステータス：{projectStatus && projectStatus !== "active" ? projectStatus : "未設定"}</summary>
          <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-3"><ProjectStatusQuick projectId={projectId} initialStatus={projectStatus} initialColor={projectStatusColor ?? "none"} canEdit={canEdit} /></div>
        </details>
        <details className="relative">
          <summary className="cursor-pointer rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">オプション</summary>
          <div className="absolute right-0 z-30 mt-2 flex w-60 max-w-[calc(100vw-48px)] flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm shadow-sm">
            <span className="text-xs text-neutral-600">書き出す</span><a href={`/api/projects/${projectId}/export?format=json`} className={link}>JSON</a><a href={`/api/projects/${projectId}/export?format=csv`} className={link}>CSV</a>
            {canEdit && <><span className="mt-2 text-xs text-neutral-600">インポート</span><ImportForm projectId={projectId} /></>}
            <span className="mt-2 text-xs text-neutral-600">共有リンク</span><ShareLinks projectId={projectId} />
          </div>
        </details>
      </div>
      <ProjectDescriptionEditor projectId={projectId} initial={description} canEdit={canEdit} heading="プロジェクトの目的" className="max-w-3xl" />
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-[1fr_1fr_1.4fr]" data-overview-facts>
        <div className="min-w-0"><dt className="text-xs text-neutral-600">プロジェクトオーナー</dt><dd className="mt-2 flex min-h-8 items-center gap-2 text-sm font-medium">{owner ? <>{memberAvatar(owner.name)}<span className="break-words">{owner.name}</span></> : "未設定"}</dd></div>
        <div><dt className="text-xs text-neutral-600">プロジェクトの期限</dt><dd className="mt-2 flex min-h-8 items-center text-base font-medium tabular-nums">{day(dueOn)}</dd></div>
        <div className="col-span-2 lg:col-span-1"><dt className="text-xs text-neutral-600">タスクの進捗</dt><dd className="mt-2 flex min-h-8 items-baseline gap-2"><span className="text-lg font-semibold tabular-nums">{stats.done} / {stats.total}</span><span className="text-sm text-neutral-600">件完了</span><span className="ml-auto text-sm font-medium tabular-nums">{progress}%</span></dd></div>
      </dl>
      <div role="progressbar" aria-label="タスクの完了率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-[#2c60b8]" style={{ width: `${progress}%` }} /></div>
      <div className="mt-8 grid min-w-0 gap-7 border-t border-neutral-200 pt-7 lg:grid-cols-2 lg:gap-10">
        <section aria-label="マイルストーン" className="min-w-0"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">マイルストーン</h2><Link href={`/projects/${projectId}?view=list`} className={`${link} text-xs`}>一覧で見る</Link></div>
          {!milestones.length ? <p className="mt-4 text-sm leading-6 text-neutral-600">マイルストーンはまだありません。リストから節目となるタスクを設定できます。</p> : <ul className="mt-3 divide-y divide-neutral-100">{milestones.map(m => <li key={m.id} className="flex items-start gap-3 py-3"><span aria-label={m.completed ? "完了" : "未完了"} className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${m.completed ? "border-[#2c60b8] bg-[#2c60b8] text-white" : "border-neutral-300"}`}>{m.completed ? "✓" : ""}</span><div className="min-w-0"><Link href={`/projects/${projectId}?view=list&task=${m.id}`} className="break-words text-sm font-medium hover:text-[#24529c] hover:underline">{m.name}</Link><p className="mt-1 text-xs tabular-nums text-neutral-600">{day(m.due_on)}</p></div></li>)}</ul>}
        </section>
        <div className="min-w-0 space-y-6">
          <section id="roles"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">メンバー <span className="ml-1 text-sm font-normal text-neutral-600">{members.length}</span></h2><ProjectShareButton projectId={projectId} projectName={projectName} label="メンバーを管理" /></div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{members.slice(0, 8).map(m => <li key={m.id} className="flex min-w-0 max-w-full items-center gap-2 text-sm">{memberAvatar(m.name)}<span className="break-words">{m.name}</span></li>)}</ul>{members.length > 8 && <p className="mt-3 text-xs text-neutral-600">ほか {members.length - 8} 人 · メンバーを管理から全員を確認できます</p>}
          </section>
          <section className="border-t border-neutral-200 pt-5"><h2 className="text-sm font-semibold">関連情報</h2><nav aria-label="プロジェクトの関連情報" className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{[["knowledge", "知識・ノート"], ["files", "ファイル"], ["messages", "メッセージ"], ["dashboard", "ダッシュボード"]].map(([view, title]) => <Link key={view} href={`/projects/${projectId}?view=${view}`} className={link}>{title}</Link>)}</nav></section>
        </div>
      </div>
      <details className="mt-7 border-t border-neutral-200 pt-4" data-overview-details><summary className="cursor-pointer rounded py-1 text-sm text-neutral-600 focus-visible:outline-blue-600">詳細な進捗とアクティビティ</summary>
        <div className="mt-5 space-y-7"><StatCards stats={stats} />
          <section><h2 className="text-sm font-semibold">セクション別進捗</h2><ul className="mt-3 space-y-3">{stats.bySection.map(s => <li key={s.id}><div className="flex justify-between gap-3 text-sm"><Link href={`/projects/${projectId}?view=list`} className="min-w-0 truncate hover:underline">{s.name}</Link><span className="shrink-0 text-xs text-neutral-600">{s.done} / {s.total}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-100"><div className="h-full bg-[#2c60b8]" style={{width: `${s.total ? Math.round(s.done / s.total * 100) : 0}%`}} /></div></li>)}</ul></section>
          <section><h2 className="text-sm font-semibold">期限が近いタスク</h2>{!stats.upcoming.length && <p className="mt-2 text-sm text-neutral-600">期限付きの未完了タスクはありません。</p>}<ul className="mt-2 divide-y divide-neutral-100">{stats.upcoming.map(t => <li key={t.id} className="py-2"><Link className={link} href={`/projects/${projectId}?view=list&task=${t.id}`}>{t.name}</Link><p className="mt-1 text-xs text-neutral-600">{day(t.due_on)} · {t.assignee_name ?? "担当者未設定"}</p></li>)}</ul></section>
          <section data-project-activity><h2 className="text-sm font-semibold">最近のアクティビティ</h2>{!activity.length && <p className="mt-2 text-sm text-neutral-600">まだアクティビティはありません。</p>}<ul className="mt-2 divide-y divide-neutral-100">{activity.map(item => <li key={`${item.kind}-${item.id}`} data-project-activity-item={`${item.kind}-${item.id}`} className="flex gap-2 py-3 text-sm"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] text-neutral-700">{(item.actor_name ?? "?").slice(0, 1)}</span><div className="min-w-0"><p className="break-words text-neutral-800">{item.summary}</p><p className="mt-1 text-xs text-neutral-600">{item.actor_name ?? "–"} · {item.created_at.slice(0, 16)}</p></div></li>)}</ul></section>
        </div>
      </details>
    </div>
  </ProjectPartnerWorkspace>;
}
