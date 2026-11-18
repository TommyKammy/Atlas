"use client";

import ProjectIcon from "../ProjectIcon";
import CustomizeRow from "./CustomizeRow";
import {
  AppsGlyph,
  AutomationGlyph,
  BundleGlyph,
  FieldGlyph,
  MailGlyph,
  StatusGlyph,
  TemplateGlyph,
} from "./icons";

/** Customize drawer home: navigation to the project's feature panels. */
export default function CustomizeHomePanel({
  projectId,
  projectName,
  color,
  icon,
  statusFieldEnabled,
  statusFieldName,
  statusValues,
  fieldCount,
  templateCount,
  appCount,
  bundleCount,
  automationCount,
  onOpen,
}: {
  projectId: number;
  projectName: string;
  color: string | null;
  icon: string | null;
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusValues: string[];
  fieldCount: number;
  templateCount: number;
  appCount: number;
  bundleCount: number;
  automationCount: number;
  onOpen: (panel: "appearance" | "status" | "fields" | "templates" | "email" | "apps" | "bundles" | "automations") => void;
}) {
  return (
    <div className="p-5">
      <section>
        <h3 className="text-[14px] font-semibold text-neutral-900">このプロジェクト</h3>
        <p className="mt-0.5 text-[12px] text-muted">このプロジェクトの機能を表示、編集する</p>
        <div className="mt-3 space-y-2">
          <CustomizeRow
            icon={
              <ProjectIcon
                id={projectId}
                name={projectName}
                color={color}
                icon={icon}
                className="h-7 w-7 text-[11px]"
              />
            }
            title="カラーとアイコン"
            description={projectName}
            onClick={() => onOpen("appearance")}
          />
          {statusFieldEnabled && (
            <CustomizeRow
              icon={<StatusGlyph />}
              title={statusFieldName}
              description={statusValues.length ? statusValues.join(" ・ ") : "ステータスを設定"}
              count={statusValues.length}
              onClick={() => onOpen("status")}
            />
          )}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-[14px] font-semibold text-neutral-900">ワークフロー機能</h3>
        <p className="mt-0.5 text-[12px] text-muted">タスクの入力項目と作成テンプレートを管理する</p>
        <div className="mt-3 space-y-2">
          <CustomizeRow
            icon={<FieldGlyph />}
            title="フィールド"
            description="タスクに数値・テキスト・単一選択の項目を追加"
            count={fieldCount + (statusFieldEnabled ? 1 : 0)}
            onClick={() => onOpen("fields")}
          />
          <CustomizeRow
            icon={<TemplateGlyph />}
            title="タスクタイプとテンプレート"
            description="繰り返し使うタスクの型を登録"
            count={templateCount}
            onClick={() => onOpen("templates")}
          />
          <CustomizeRow
            icon={<MailGlyph />}
            title="メールアドレス"
            description="プロジェクト宛メールからタスクを作成"
            onClick={() => onOpen("email")}
          />
          <CustomizeRow
            icon={<AppsGlyph />}
            title="アプリ"
            description="Slack・Google Drive・Webhookなどと連携"
            count={appCount}
            onClick={() => onOpen("apps")}
          />
          <CustomizeRow
            icon={<BundleGlyph />}
            title="バンドル"
            description="複数のフィールドをまとめてプロジェクトへ追加"
            count={bundleCount}
            onClick={() => onOpen("bundles")}
          />
          <CustomizeRow
            icon={<AutomationGlyph />}
            title="AIと自動化"
            description="ルールとAIアシストで作業を自動化"
            count={automationCount}
            onClick={() => onOpen("automations")}
          />
        </div>
      </section>

      <p className="mt-6 rounded-md bg-surface-subtle px-3 py-2 text-[11px] leading-4 text-muted">
        カスタマイズはこのプロジェクトに保存され、リスト・ボード・タイムラインなどの各ビューに反映されます。
      </p>
    </div>
  );
}
