"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Portfolio, PortfolioProject, PortfolioRule } from "@/lib/portfolios";
import { confirmAction, toast } from "@/lib/ui-feedback";
import AutomationRulesPanel from "./customize/AutomationRulesPanel";

type PortfolioDetail = {
  portfolio: Portfolio;
  projects: PortfolioProject[];
  rules: PortfolioRule[];
};

export default function PortfolioWorkspace({
  initialPortfolios,
  initialSelectedId,
  availableProjects,
}: {
  initialPortfolios: Portfolio[];
  initialSelectedId?: number;
  availableProjects: { id: number; name: string }[];
}) {
  const [portfolios, setPortfolios] = useState(initialPortfolios);
  const [selectedId, setSelectedId] = useState<number | null>(
    initialSelectedId && initialPortfolios.some((portfolio) => portfolio.id === initialSelectedId)
      ? initialSelectedId
      : initialPortfolios[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadPortfolios = async (select?: number) => {
    const res = await fetch("/api/portfolios");
    if (res.ok) {
      const data = (await res.json()) as { portfolios: Portfolio[] };
      setPortfolios(data.portfolios);
      setSelectedId((current) => select ?? current ?? data.portfolios[0]?.id ?? null);
    }
  };

  const loadDetail = async (id: number) => {
    const res = await fetch(`/api/portfolios/${id}`);
    if (res.ok) {
      setDetail((await res.json()) as PortfolioDetail);
    } else {
      setDetail(null);
    }
  };

  useEffect(() => {
    if (selectedId === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set("portfolio", String(selectedId));
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    fetch(`/api/portfolios/${selectedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortfolioDetail | null) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const create = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: number }>("/api/portfolios", "POST", {
        name: name.trim(),
        description: description.trim(),
      });
      setName("");
      setDescription("");
      await loadPortfolios(result.id);
      await loadDetail(result.id);
      toast("ポートフォリオを作成しました");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (portfolio: Portfolio) => {
    if (!(await confirmAction(`ポートフォリオ「${portfolio.name}」を削除しますか？ 申請・採用履歴がある場合は削除できません。`))) return;
    setBusy(true);
    try {
      await api(`/api/portfolios/${portfolio.id}`, "DELETE");
      await loadPortfolios();
      if (selectedId === portfolio.id) {
        setSelectedId(null);
        setDetail(null);
      }
      toast("ポートフォリオを削除しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const addProject = async () => {
    if (!detail || projectId === "" || busy) return;
    setBusy(true);
    try {
      await api(`/api/portfolios/${detail.portfolio.id}/projects`, "POST", {
        project_id: Number(projectId),
      });
      setProjectId("");
      await loadDetail(detail.portfolio.id);
      await loadPortfolios(detail.portfolio.id);
      toast("プロジェクトを追加しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeProject = async (project: PortfolioProject) => {
    if (!detail || !(await confirmAction(`「${project.name}」をポートフォリオから外しますか？`))) return;
    setBusy(true);
    try {
      await api(`/api/portfolios/${detail.portfolio.id}/projects?project_id=${project.id}`, "DELETE");
      await loadDetail(detail.portfolio.id);
      await loadPortfolios(detail.portfolio.id);
      toast("プロジェクトを外しました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const selectedProjectIds = new Set(detail?.projects.map((project) => project.id) ?? []);
  const addableProjects = availableProjects.filter((project) => !selectedProjectIds.has(project.id));

  return (
    <section className="mt-8 max-w-6xl" data-portfolio-workspace>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">共有ポートフォリオ</h2>
          <p className="mt-0.5 text-xs text-muted">
            複数プロジェクトをまとめ、ポートフォリオ単位のルールを実行できます。
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="space-y-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="新しいポートフォリオ名"
              className="h-8 w-full rounded-md border border-line px-2 text-[12px] outline-none focus:border-accent"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="説明（任意）"
              className="h-8 w-full rounded-md border border-line px-2 text-[12px] outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || name.trim() === ""}
              className="h-8 w-full rounded-md bg-accent text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              ＋ ポートフォリオを作成
            </button>
            {error && <p className="text-[11px] text-danger">{error}</p>}
          </div>
          <div className="mt-3 space-y-1 border-t border-line-subtle pt-3">
            {portfolios.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-muted">
                ポートフォリオはまだありません。
              </p>
            ) : (
              portfolios.map((portfolio) => (
                <button
                  key={portfolio.id}
                  type="button"
                  onClick={() => setSelectedId(portfolio.id)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
                    selectedId === portfolio.id ? "bg-accent-soft" : "hover:bg-hover"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-text">
                      {portfolio.name}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {portfolio.project_count}プロジェクト・{portfolio.rule_count}ルール
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="min-w-0">
          {detail === null ? (
            <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center text-[12px] text-muted">
              ポートフォリオを選択するか、新規作成してください。
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold text-text">
                        {detail.portfolio.name}
                      </h3>
                      {detail.portfolio.can_view_plan && (
                        <Link
                          href={`/portfolio/${detail.portfolio.id}/planning?view=ledger`}
                          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
                        >
                          投資計画を開く →
                        </Link>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {detail.portfolio.description || "説明はありません"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      所有者: {detail.portfolio.owner_name ?? "不明"} ・{" "}
                      {detail.portfolio.project_count}プロジェクト
                    </p>
                  </div>
                  {detail.portfolio.can_edit && (
                    <button
                      type="button"
                      onClick={() => void remove(detail.portfolio)}
                      disabled={busy}
                      className="text-[11px] text-subtle hover:text-danger disabled:opacity-50"
                    >
                      ポートフォリオを削除
                    </button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detail.projects.map((project) => (
                    <span
                      key={project.id}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-subtle px-2 py-0.5 text-[11px] text-secondary"
                    >
                      {project.name}
                      {detail.portfolio.can_edit && (
                        <button
                          type="button"
                          aria-label={`${project.name}を外す`}
                          onClick={() => void removeProject(project)}
                          disabled={busy}
                          className="text-subtle hover:text-danger"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {detail.projects.length === 0 && (
                    <span className="text-[11px] text-muted">
                      プロジェクトがありません。
                    </span>
                  )}
                </div>

                {detail.portfolio.can_edit && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                      className="h-8 min-w-0 max-w-full rounded-md border border-line bg-field px-2 text-[12px]"
                    >
                      <option value="">プロジェクトを選択…</option>
                      {addableProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void addProject()}
                      disabled={busy || projectId === ""}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-secondary hover:bg-hover disabled:opacity-50"
                    >
                      プロジェクトを追加
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-line bg-surface">
                <AutomationRulesPanel
                  key={detail.portfolio.id}
                  projectId={0}
                  initialRules={detail.rules}
                  canEdit={detail.portfolio.can_edit}
                  rulesApiBase={`/api/portfolios/${detail.portfolio.id}/rules`}
                  descriptorsUrl={`/api/portfolios/${detail.portfolio.id}/descriptors`}
                  runUrlBase={`/api/portfolios/${detail.portfolio.id}/rules`}
                  aiSuggestUrl={`/api/portfolios/${detail.portfolio.id}/rules/ai-suggest`}
                  allowManualRun={false}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
