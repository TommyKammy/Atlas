import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { getWorkspace } from "@/lib/data";
import { getPortfolio } from "@/lib/repositories/portfolios";
import PlanningWorkspace from "@/components/portfolio/planning/PlanningWorkspace";
import { parsePlanningView } from "@/lib/planning/types";

export const instant = false;
export const metadata = { title: "投資計画 | Atlas" };

function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PlanningPage(props: {
  params: Promise<{ portfolioId: string }>;
  searchParams: Promise<{ view?: string | string[]; period?: string | string[] }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const portfolioId = Number(params.portfolioId);
  if (!Number.isInteger(portfolioId) || portfolioId <= 0) notFound();

  const ws = await getWorkspace();
  if (!ws) notFound();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");

  const portfolio = await getPortfolio(portfolioId, ws.id, viewerId);
  if (!portfolio) notFound();

  const backHref = `/portfolio?portfolio=${portfolioId}`;
  if (!portfolio.can_view_plan) {
    return (
      <div className="mx-auto max-w-[820px] px-4 py-10 md:px-6">
        <nav aria-label="パンくず" className="text-[12px] text-muted">
          <Link href={backHref} className="text-accent-text hover:underline">
            ポートフォリオ
          </Link>
          <span className="mx-1.5" aria-hidden>›</span>
          <span>投資計画</span>
        </nav>
        <div className="mt-5 rounded-lg border border-line bg-surface p-6">
          <h1 className="text-[20px] font-semibold text-text">投資計画を表示できません</h1>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            この投資計画を表示する権限がありません。共有ポートフォリオの所有者またはワークスペース管理者に、閲覧者として追加を依頼してください。
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover"
          >
            ポートフォリオに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PlanningWorkspace
      portfolioId={portfolioId}
      portfolioName={portfolio.name}
      backHref={backHref}
      initialPeriod={single(searchParams.period)}
      initialView={parsePlanningView(single(searchParams.view))}
    />
  );
}
