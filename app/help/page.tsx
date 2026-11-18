import Link from "next/link";

export const instant = false;

const SHORTCUTS: [string, string][] = [
  ["?", "ショートカット一覧の表示/非表示"],
  ["n", "タスク追加欄にフォーカス"],
  ["g → o/d/l/b/t/c/m/f", "各ビューへ移動"],
  ["↑ / ↓", "リスト内のタスク行を移動"],
  ["Enter", "選択中のタスクを開く"],
  ["Esc", "タスクペイン / ヘルプを閉じる"],
];

export default function HelpPage() {
  return (
    <div data-help-page className="max-w-3xl p-6 pb-16 text-sm text-secondary">
      <h1 className="text-xl font-bold text-text">ヘルプと始め方</h1>
      <p className="mt-2 text-muted">
        Atlas の基本操作、連携、ショートカットをまとめています。
      </p>

      <section id="about" data-help-section="about" className="mt-6 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">Atlas について</h2>
        <p className="mt-1">
          Atlas はプロジェクト、タスク、タイムライン、ポートフォリオを一か所で管理するワークマネジメントツールです。
          リスト・ボード・タイムライン・カレンダー・ダッシュボードを同じデータで切り替えられます。
        </p>
      </section>

      <section id="features" data-help-section="features" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">機能に関するヘルプ</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>タスクの作成・編集・サブタスク・依存関係・添付ファイル</li>
          <li>プロジェクトの Status、カスタムフィールド、テンプレート、ルール</li>
          <li>マイタスクのドラッグ並び替えと期日変更</li>
          <li>グローバル検索（タスク / プロジェクト / メッセージ / 知識 / ファイル）と保存検索</li>
          <li>受信トレイ、ポートフォリオ、フォーム、プロジェクトメール</li>
        </ul>
        <p className="mt-2">
          まずは <Link href="/my-tasks" className="text-accent-text hover:underline">マイタスク</Link> または
          <Link href="/projects/1?view=list" className="ml-1 text-accent-text hover:underline">デモプロジェクト</Link>
          から始めてください。
        </p>
      </section>

      <section id="integrations" data-help-section="integrations" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">アプリと連携</h2>
        <p className="mt-1">
          プロジェクトの「カスタマイズ → アプリ」から Slack、Google Drive、GitHub、Webhook を追加できます。
          プロジェクト専用メールアドレスやフォームからもタスクを取り込めます。
        </p>
        <Link href="/projects/1?view=list" className="mt-2 inline-block text-accent-text hover:underline">
          プロジェクトのカスタマイズを開く
        </Link>
      </section>

      <section id="videos" data-help-section="videos" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">動画チュートリアル</h2>
        <p className="mt-1">
          画面共有用のチュートリアル動画は現在準備中です。操作手順はこのヘルプとキーボードショートカット一覧を参照してください。
        </p>
      </section>

      <section id="shortcuts" data-help-section="shortcuts" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">キーボードショートカット</h2>
        <div className="mt-2 space-y-2">
          {SHORTCUTS.map(([key, description]) => (
            <div key={key} className="flex gap-3">
              <kbd className="shrink-0 rounded border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="privacy" data-help-section="privacy" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">プライバシーステートメント</h2>
        <p className="mt-1">
          Atlas はデモ環境です。入力されたプロジェクト・タスク・コメントはこの環境内でのみ利用され、
          外部サービスへ送信されません。検証データは管理者が削除できます。
        </p>
      </section>

      <section id="workspaces" data-help-section="workspaces" className="mt-4 rounded-lg border border-line p-4">
        <h2 className="text-base font-semibold text-text">ワークスペースとライセンス</h2>
        <p className="mt-1">
          この Atlas 環境は単一ワークスペース構成です。ワークスペースの追加やライセンス管理は管理者コンソールから行います。
        </p>
        <Link href="/admin" className="mt-2 inline-block text-accent-text hover:underline">
          管理者コンソール
        </Link>
      </section>
    </div>
  );
}
