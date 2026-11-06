export type AppField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
};

export type AppDefinition = {
  key: string;
  name: string;
  description: string;
  fields: AppField[];
};

export type ProjectApp = {
  id: number;
  project_id: number;
  app_key: string;
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export const APP_CATALOG: AppDefinition[] = [
  {
    key: "slack",
    name: "Slack",
    description: "タスクの更新を Slack チャンネルへ通知します。",
    fields: [{ key: "channel", label: "通知先チャンネル", placeholder: "#general", required: true }],
  },
  {
    key: "google-drive",
    name: "Google Drive",
    description: "プロジェクトのファイルを Drive フォルダと連携します。",
    fields: [{ key: "folder", label: "フォルダURL", placeholder: "https://drive.google.com/...", required: true }],
  },
  {
    key: "github",
    name: "GitHub",
    description: "Issue とプルリクエストをタスクにリンクします。",
    fields: [{ key: "repository", label: "リポジトリ", placeholder: "owner/repo", required: true }],
  },
  {
    key: "webhook",
    name: "Webhook",
    description: "プロジェクトのイベントを任意のURLへ送信します。",
    fields: [{ key: "url", label: "送信先URL", placeholder: "https://example.com/hook", required: true }],
  },
];

export function appDefinition(key: string): AppDefinition | undefined {
  return APP_CATALOG.find((app) => app.key === key);
}
