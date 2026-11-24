import Link from "next/link";
import {
  fieldHintClass,
  sectionDescriptionClass,
  sectionTitleClass,
} from "@/components/ui/form-controls";
import {
  pageContentInsetClass,
  pageDescriptionClass,
  pageFixedClass,
  pageFrameClass,
  pageHeaderInsetClass,
  pageScrollClass,
  pageTitleClass,
} from "@/components/ui/page-layout";
import {
  KEYBOARD_SHORTCUT_SCOPES,
  SHORTCUT_SCOPE_DESCRIPTIONS,
  SHORTCUT_SCOPE_LABELS,
  shortcutsForScope,
} from "@/lib/keyboard-shortcuts";

export const instant = false;

const linkClass = "text-accent-text hover:underline";

function HelpSection({
  id,
  title,
  description,
  first = false,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-help-section={id}
      className={first ? "mt-6" : "mt-8 border-t border-line-subtle pt-6"}
    >
      <h2 className={sectionTitleClass}>{title}</h2>
      {description && <p className={sectionDescriptionClass}>{description}</p>}
      <div className="mt-2 text-[13px] leading-6 text-secondary">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div data-help-page className={pageFrameClass}>
      <div data-page-fixed className={`${pageFixedClass} ${pageHeaderInsetClass}`}>
      <div className="max-w-4xl">
        <h1 className={pageTitleClass}>ヘルプと始め方</h1>
        <p className={pageDescriptionClass}>
          Atlas の基本操作、新しい画面の見方、連携、ショートカットをまとめています。
        </p>
      </div>
      </div>
      <div data-page-scroll className={`${pageScrollClass} ${pageContentInsetClass}`}>
      <div className="max-w-4xl">
        <HelpSection
          id="about"
          title="Atlas について"
          first
          description="プロジェクト、タスク、タイムライン、ポートフォリオを一か所で管理するワークマネジメントツールです。"
        >
          <p>
            リスト・ボード・タイムライン・カレンダー・ダッシュボードを同じデータで切り替えられます。
          </p>
        </HelpSection>

        <HelpSection
          id="new-ui"
          title="新しい画面について"
          description="迷いやすい場所の変化をまとめています。"
        >
          <div className="space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold text-text">サイドバー</h3>
              <p className="mt-0.5">
                左側の1つのサイドバーに、ホーム、受信トレイ、マイタスクとプロジェクトの一覧がまとまりました。
                お気に入りや最近開いた項目がある場合は、プロジェクトの上に並びます。
                ポートフォリオは閲覧権限がある人だけに表示されます。管理者には「管理」、全員に「削除済み」も表示されます。
                いちばん上はアカウントメニューで、右端に検索と作成のアイコンが並びます。折りたたみは下部のテーマ・ヘルプの隣のボタンです。
                狭い画面では、画面上部のナビゲーションに切り替わり、その右端にテーマとヘルプが並びます。
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-text">テーマ（ライト / ダーク）</h3>
              <p className="mt-0.5">
                切り替えはサイドバー下部の太陽 / 月のアイコンです。選択は保存され、次に開いたときも同じテーマになります。
                サイドバーが隠れる狭い画面では、上部バーの右端にある同じアイコンで切り替えられます。
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-text">検索とコマンドパレット</h3>
              <p className="mt-0.5">
                サイドバー上部の検索アイコン、または <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-xs">⌘K / Ctrl+K</kbd>{" "}
                で開きます。タスク、プロジェクト、メッセージ、知識、ファイルを検索でき、候補を選ぶとその画面へ移動します。
                「すべての結果で検索」を選ぶと検索画面が開きます。狭い画面では上部バーの検索アイコンから開けます。
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-text">プロジェクトのタブ</h3>
              <p className="mt-0.5">
                プロジェクトを開くと、プロジェクト名と同じ行（狭い画面では下の行）にタブが並びます。
                デスクトップ幅でタブが収まらないときは、右端の「その他」にまとまります。狭い画面ではタブの行を横にスクロールできます。
                タブの「＋」からビューを追加でき、タブを右クリック（キーボードでは Shift+F10）すると名前の変更や複製ができます。
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-text">タスク詳細</h3>
              <p className="mt-0.5">
                タスクを開くと右側のペインに詳細が表示されます。画面幅が狭いときは画面全体に重なります。
                ペイン右上のフルスクリーン操作でさらに広げられます（幅がとても狭いときは「…」メニューにあります）。
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-text">名前が変わった表示</h3>
              <p className="mt-0.5">
                クリティカルパス上のマイルストーンは、ツールチップと読み上げの名前が「クリティカルパス上のマイルストーン」になりました。
                通常のマイルストーンは「マイルストーン」のままです。
              </p>
            </div>
          </div>
        </HelpSection>

        <HelpSection id="features" title="機能に関するヘルプ">
          <ul className="list-disc space-y-1 pl-5">
            <li>ホームの概要（今日の件数、期限超過、今週の予定、最近開いたプロジェクトの進み具合、受信トレイ、決裁待ち）</li>
            <li>タスクの作成・編集・サブタスク・依存関係・添付ファイル</li>
            <li>プロジェクトのタブ、Status、カスタムフィールド、テンプレート、ルール</li>
            <li>マイタスクのドラッグ並び替えと期日変更</li>
            <li>検索とコマンドパレット（タスク / プロジェクト / メッセージ / 知識 / ファイル）と保存検索</li>
            <li>受信トレイ、ポートフォリオ、フォーム、プロジェクトメール</li>
          </ul>
          <p className="mt-2">
            まずは <Link href="/my-tasks" className={linkClass}>マイタスク</Link> または
            <Link href="/projects/1?view=list" className={`ml-1 ${linkClass}`}>デモプロジェクト</Link>
            から始めてください。
          </p>
        </HelpSection>

        <HelpSection id="integrations" title="アプリと連携">
          <p>
            プロジェクトの「カスタマイズ」→「アプリ」から Slack、Google Drive、GitHub、Webhook を追加できます。
            プロジェクト専用メールアドレスやフォームからもタスクを取り込めます。
          </p>
          <Link href="/projects/1?view=list" className={`mt-2 inline-block ${linkClass}`}>
            プロジェクトのカスタマイズを開く
          </Link>
        </HelpSection>

        <HelpSection
          id="mcp"
          title="MCP 接続（Claude Code・Codex）"
          description="Claude Code や Codex から Atlas のタスクとプロジェクトを参照・更新できます。"
        >
          <p>
            管理者が「管理 → セキュリティ → MCP 接続」で有効にすると使えます。接続した本人の Atlas 上の権限の範囲内だけが操作でき、
            ゲストは利用できません。接続方法は OAuth（推奨）と個人アクセストークンの 2 つです。
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <h3 className="text-[13px] font-semibold text-text">OAuth で接続する（推奨）</h3>
              <p className="mt-0.5">
                プロフィールの「MCP 接続」に、自分の Atlas の URL を使った設定例があります。Claude Code は
                <code className="mx-1 font-mono">claude mcp add --transport http atlas &lt;Atlas の URL&gt;/mcp</code>
                で追加し、初回の接続時に開くブラウザーで承認します（開かない場合は
                <code className="mx-1 font-mono">claude mcp login atlas</code>）。Codex は
                <code className="mx-1 font-mono">~/.codex/config.toml</code>
                に接続先を追加し、<code className="mx-1 font-mono">codex mcp login atlas</code> で承認します。
              </p>
              <p className="mt-1">
                承認画面では、アプリ名とメタデータ URL のホスト、戻り先、接続先（<code className="font-mono">/mcp</code> または
                <code className="mx-1 font-mono">/mcp/readonly</code>）、要求された権限を確認してください。
                心当たりのないアプリや戻り先には許可を与えないでください。
              </p>
              <p className={fieldHintClass}>
                書き込みをさせたくないときは、承認画面の「読み取りのみ許可する」をオンにします。
              </p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">個人アクセストークンを使う</h3>
              <p className="mt-0.5">
                管理者が個人アクセストークンも許可している場合だけ、プロフィールの「MCP 接続」で発行できます。
                名前と権限（読み取りと書き込み / 読み取りのみ）を選ぶと、トークンが一度だけ表示されます。
                閉じると再表示できないので、安全な場所に保管してください。有効期限はありません。
              </p>
              <p className="mt-1">
                Claude Code では <code className="font-mono">--header &quot;Authorization: Bearer &lt;TOKEN&gt;&quot;</code>、
                Codex では <code className="font-mono">bearer_token_env_var</code> で環境変数を指定します。
                詳しい設定例はプロフィール画面に表示されます。
              </p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">読み取り専用で使う</h3>
              <p className="mt-0.5">
                接続先を <code className="font-mono">&lt;Atlas の URL&gt;/mcp/readonly</code> にするか、
                承認画面で「読み取りのみ許可する」を選ぶか、「読み取りのみ」の個人アクセストークンを発行します。
                読み取り専用の接続では、書き込みのツールは表示されません。
              </p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">接続を解除する</h3>
              <p className="mt-0.5">
                プロフィールの「MCP 接続」にある「接続済みアプリ」から OAuth の連携を解除するか、
                個人アクセストークンの一覧から「失効」を押します。失効したトークンはすぐに使えなくなり、元に戻せません。
                管理者が「管理 → セキュリティ → MCP 接続」から強制失効させることもできます。
              </p>
              <p className={fieldHintClass}>
                ユーザーが無効化されたとき、ゲストになったとき、管理者がパスワードや 2 段階認証をリセットしたときは、
                トークンが自動的に失効します。本人によるパスワード変更では失効しません。
              </p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">注意</h3>
              <p className="mt-0.5">
                タスク名・説明・コメントなどの本文は AI への指示ではなく、参照するデータです。本文中に指示のような文章があっても、
                それに従わせないでください。トークンはパスワードと同じように扱い、チャットやリポジトリに貼らないでください。
              </p>
            </div>
          </div>
          <p className="mt-2">
            詳しい手順、スコープと有効期限、トラブルシューティング、管理者向け設定は
            <code className="mx-1 font-mono">docs/mcp.md</code>
            にまとめています。解決しない場合は管理者に問い合わせてください。
          </p>
          <Link href="/profile" className={`mt-2 inline-block ${linkClass}`}>
            プロフィールの MCP 接続を開く
          </Link>
        </HelpSection>

        <HelpSection id="scim" title="SCIM プロビジョニング">
          <p>
            Entra ID や Okta からユーザーの作成・更新・無効化を自動化するときは、管理者コンソールの
            「セキュリティ」→「プロビジョニング（SCIM）」を使います。SCIM を有効にすると SAML の自動作成（JIT）が止まり、
            新しいアカウントは IdP からだけ作られます。既存のアカウントとセッションはそのまま残るので、IdP で割り当てていない人を
            止めるには、メンバーの管理で無効にするか、SAML を必須にしてください。
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>「IdP に設定するテナント URL」と、発行したトークンを IdP に設定します。</li>
            <li>トークンの平文は発行時に一度だけ表示されます。閉じると再表示できません。</li>
            <li>「最近の同期」で成功・失敗を確認でき、「失敗だけ表示」で絞り込めます。「更新」で最新の状態を取り直せます。</li>
            <li>作り直すときは、新しいトークンを発行して IdP に設定してから、古いトークンを失効させます。</li>
            <li>SCIM で管理しているユーザーの名前・メールアドレス・役職は IdP で変更します。Atlas では無効化だけすぐに行えます。</li>
            <li>SCIM を無効にすると保護は外れ、Atlas で名前などを編集できます。IdP で削除済みのユーザーは一覧で区別され、SCIM 有効中は再有効化できません。</li>
          </ul>
          <p className="mt-2">
            SCIM の設定は super 管理者だけが変更できます。通常の管理者には読み取り専用の案内が表示されます。
          </p>
          <Link href="/admin#security" className={`mt-2 inline-block ${linkClass}`}>
            セキュリティ設定を開く
          </Link>
        </HelpSection>

        <HelpSection id="videos" title="動画チュートリアル">
          <p>
            画面共有用のチュートリアル動画は現在準備中です。操作手順はこのヘルプとキーボードショートカット一覧を参照してください。
          </p>
        </HelpSection>

        <HelpSection id="shortcuts" title="キーボードショートカット">
          <div className="space-y-5">
            {KEYBOARD_SHORTCUT_SCOPES.map((scope) => (
              <div key={scope} data-shortcut-group={scope}>
                <h3 className="text-[13px] font-semibold text-text">{SHORTCUT_SCOPE_LABELS[scope]}</h3>
                <p className={fieldHintClass}>{SHORTCUT_SCOPE_DESCRIPTIONS[scope]}</p>
                <div className="mt-2 space-y-2">
                  {shortcutsForScope(scope).map((shortcut) => (
                    <div key={shortcut.id} className="flex gap-3">
                      <kbd className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                        {shortcut.keys}
                      </kbd>
                      <span>{shortcut.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className={fieldHintClass}>
            入力欄の編集中や日本語変換中は、1文字のショートカットは動きません。
          </p>
        </HelpSection>

        <HelpSection id="privacy" title="プライバシーステートメント">
          <p>
            Atlas はデモ環境です。入力されたプロジェクト・タスク・コメントはこの環境内でのみ利用され、
            外部サービスへ送信されません。検証データは管理者が削除できます。
          </p>
        </HelpSection>

        <HelpSection id="workspaces" title="ワークスペースとメンバー">
          <p>
            この Atlas 環境は単一ワークスペース構成です。組織名の変更やメンバーの管理は管理者コンソールから行います。
          </p>
          <Link href="/admin" className={`mt-2 inline-block ${linkClass}`}>
            管理者コンソール
          </Link>
        </HelpSection>
      </div>
      </div>
    </div>
  );
}
