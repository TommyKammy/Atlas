import Link from "next/link";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import { getPortfolio, getPortfolioProjects, getWorkspace } from "@/lib/data";
import { hasPermission } from "@/lib/permissions";
import { requirePageUser } from "@/lib/current-user";
import { getPortfolios } from "@/lib/repositories/portfolios";
import PortfolioWorkspace from "@/components/PortfolioWorkspace";

export const instant = false;

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ portfolio?: string | string[] }>;
}) {
  const viewer = await requirePageUser();
  const viewerId = viewer.id;
  const ws = await getWorkspace();
  const rows = ws ? await getPortfolio(ws.id, viewerId) : [];
  const saved = await getPortfolioProjects(viewerId);
  const portfolios = ws ? await getPortfolios(ws.id, viewerId) : [];
  const params = await searchParams;
  const selectedParam = Array.isArray(params.portfolio) ? params.portfolio[0] : params.portfolio;
  const requestedPortfolioId = Number(selectedParam);
  const initialSelectedId =
    Number.isInteger(requestedPortfolioId) && requestedPortfolioId > 0
      ? requestedPortfolioId
      : undefined;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">ポートフォリオ</h1>
        {viewer.isAdmin && await hasPermission(viewerId, "audit.view") && <a href="/audit" className="text-sm text-accent-text hover:underline">
          監査ログ →
        </a>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {ws?.name} の全プロジェクト（{rows.length}件）
      </p>
      <div className="mt-4 max-w-5xl">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">マイポートフォリオ</h2>
          <span className="text-xs text-muted">{saved.length}件</span>
        </div>
        {saved.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            サイドバーのプロジェクトを右クリック →「ポートフォリオに追加」でここに追加されます。
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {saved.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}?view=list`}
                className="rounded-full border bg-surface px-2.5 py-1 text-xs text-secondary hover:bg-hover"
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 max-w-5xl">
        {/* The project table keeps its five columns on narrow screens and
            scrolls inside this region instead of widening the page. */}
        <div className="overflow-x-auto" data-portfolio-projects-scroll>
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[minmax(160px,1fr)_200px_120px_80px_220px] gap-2 border-b px-2 py-2 text-xs font-semibold text-muted">
              <span>プロジェクト</span>
              <span>進捗</span>
              <span>期間</span>
              <span>メンバー</span>
              <span>期限超過</span>
            </div>
            {rows.map((p) => {
              const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[minmax(160px,1fr)_200px_120px_80px_220px] items-center gap-2 border-b px-2 py-2 text-sm hover:bg-hover"
                >
                  <Link href={`/projects/${p.id}?view=list`} className="truncate font-medium hover:underline">
                    {p.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-surface-strong">
                      <span className={`block h-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {p.done}/{p.total}
                    </span>
                  </span>
                  <span className="truncate text-xs text-secondary">
                    {p.min_due ?? "–"} 〜 {p.max_due ?? "–"}
                  </span>
                  <span className="text-secondary">{p.members}人</span>
                  <span className={p.overdue > 0 ? "font-semibold text-danger" : "text-muted"}>
                    {p.overdue > 0 ? `${p.overdue}件` : "なし"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <PortfolioWorkspace
        initialPortfolios={portfolios}
        initialSelectedId={initialSelectedId}
        availableProjects={rows.map((row) => ({ id: row.id, name: row.name }))}
      />
    </div>
  );
}
