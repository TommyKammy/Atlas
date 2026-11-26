"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { WorkspaceFeatures } from "@/lib/services/workspace-features";
import { sectionDescriptionClass, sectionTitleClass } from "./ui/form-controls";

/** Admin → Features: optional workspace features (docs/dev-projects-phase0.md §9). */
export default function FeaturesPanel() {
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ features: WorkspaceFeatures }>("/api/admin/features")
      .then((data) => setFeatures(data.features))
      .catch((error) => setMessage(`読み込みに失敗しました: ${error instanceof Error ? error.message : error}`));
  }, []);

  const toggleDevProjects = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const data = await api<{ features: WorkspaceFeatures }>("/api/admin/features", "PATCH", { dev_projects: next });
      setFeatures(data.features);
      setMessage(next ? "開発プロジェクトを許可しました" : "開発プロジェクトの許可を取り消しました");
    } catch (error) {
      setMessage(`保存に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setSaving(false);
    }
  };

  const enabled = features?.dev_projects === true;
  return (
    <section data-admin-panel="features">
      <h2 className={sectionTitleClass}>機能</h2>
      <p className={sectionDescriptionClass}>
        組織で使う追加の機能を選びます。初期状態ではすべて無効です。
      </p>
      <div className="mt-4 grid max-w-3xl gap-2">
        <div className="flex items-start justify-between gap-4 rounded-md bg-surface-subtle px-3 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text">開発プロジェクト</div>
            <p className="mt-0.5 text-[12px] leading-5 text-muted">
              プロジェクトの設定権限を持つ人が、プロジェクトを開発プロジェクトにできるようにします。開発プロジェクトのタスクには
              ATL-123 のような課題キーが付き、Claude Code などのコーディングエージェントからキーで参照・着手できます。
              許可を取り消しても、すでに有効化したプロジェクトとキーはそのまま使えます（設定の変更と新たな有効化だけができなくなります）。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="開発プロジェクトを許可"
            disabled={features === null || saving}
            onClick={() => void toggleDevProjects(!enabled)}
            data-feature-toggle="dev_projects"
            className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              enabled ? "bg-accent" : "bg-surface-strong"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-4 w-4 rounded-full border border-line-strong bg-surface shadow-sm transition-transform ${
                enabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {message && <p className="text-[12px] leading-5 text-muted" role="status">{message}</p>}
      </div>
    </section>
  );
}
