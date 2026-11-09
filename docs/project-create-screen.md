# プロジェクト作成画面（Asana風）

## 目的

ホーム画面下部にあった `ProjectTemplateBar` を廃止し、プロジェクト作成を専用のコンテンツ画面に集約する。

Asana の `create-project` はテンプレートギャラリーを表示するが、Atlas ではテンプレート専用画面へ遷移するのではなく、`/projects/new` のコンテンツ領域に「テンプレートから作成」と「空のプロジェクト」をまとめて表示する。

## 画面構成

- 左ナビ
  - テンプレートギャラリー
  - あなたのテンプレート
  - 空のプロジェクト
  - テンプレートを増やすためのヒント
- テンプレートギャラリー
  - テンプレート検索
  - すべて / あなたのテンプレート
  - 空のプロジェクトカード
  - あなたのテンプレート
  - ワークスペースのテンプレート
- テンプレート詳細
  - セクション数・タスク数
  - セクション一覧
  - 含まれるタスクの例
  - プロジェクト名を入力して作成
- 空のプロジェクト
  - プロジェクト名を入力して作成

## 導線

- ヘッダー「＋ 作成」→「プロジェクト」→ `/projects/new`
- サイドバーのプロジェクト「＋」→ `/projects/new`
- ホームのプロジェクトウィジェット「＋ 新規プロジェクト」→ `/projects/new`
- プロジェクトの「…」→「テンプレートとして保存」は従来どおり利用可能

## 実装

- `app/projects/new/page.tsx`
- `components/project-create/ProjectCreateScreen.tsx`
- `lib/project-templates.ts`
- `getProjectTemplateSummaries()` in `lib/repositories/projects.ts`
- `GET /api/project-templates` now returns gallery summaries with section/task previews

## 廃止

- `components/ProjectTemplateBar.tsx`
- ホーム画面下部のプロジェクトテンプレートバー
- `components/NewProjectForm.tsx`（ホーム内のインライン作成）

## 標準テンプレート（2026-11-09追加）

Asanaの人気テンプレートを参考に、Atlas標準の12テンプレートを追加した。

- プロジェクト管理 / エンジニアリング / マーケティング / オペレーション / 人材 / 生産性
- ギャラリー上部に「Atlas おすすめテンプレート」として表示
- カテゴリフィルタと検索に対応
- 標準テンプレートは削除不可
- 詳細: `docs/default-project-templates.md`
