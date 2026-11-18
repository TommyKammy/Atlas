import type { ProjectIconKey } from "./project-appearance";
import { TEMPLATE_COLORS } from "./data-colors";
import type { ProjectTemplatePayload, TemplateTask } from "./project-template-payload";

export type DefaultProjectTemplate = {
  key: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: ProjectIconKey;
  sections: { name: string; tasks: TemplateTask[] }[];
};

function task(name: string, dueOffsetDays: number, subtasks: string[] = []): TemplateTask {
  return {
    name,
    due_offset_days: dueOffsetDays,
    subtasks: subtasks.map((subtask) => ({
      name: subtask,
      due_offset_days: dueOffsetDays,
    })),
  };
}

export const DEFAULT_PROJECT_TEMPLATES: DefaultProjectTemplate[] = [
  {
    key: "project-management",
    name: "プロジェクトマネジメント",
    description: "キックオフから振り返りまで、プロジェクトの計画・実行・完了を一貫して管理",
    category: "プロジェクト管理",
    color: TEMPLATE_COLORS.blue,
    icon: "target",
    sections: [
      {
        name: "計画",
        tasks: [
          task("キックオフミーティング", 1, ["目的とゴールを共有", "スコープを確認", "役割分担を決める"]),
          task("プロジェクト計画を作成", 3),
          task("ステークホルダーを洗い出す", 2),
          task("リスクと懸念事項を整理", 6),
        ],
      },
      {
        name: "実行",
        tasks: [
          task("マイルストーンを設定", 7),
          task("定例ミーティングを開催", 14),
          task("進捗レポートを共有", 21),
        ],
      },
      {
        name: "完了",
        tasks: [
          task("成果物を最終確認", 30),
          task("振り返りを実施", 32),
          task("学びをナレッジに記録", 34),
        ],
      },
    ],
  },
  {
    key: "engineering-project",
    name: "エンジニアリングプロジェクト計画",
    description: "要件定義からリリースまで、開発プロジェクトの工程を整理",
    category: "エンジニアリング",
    color: TEMPLATE_COLORS.teal,
    icon: "rocket",
    sections: [
      {
        name: "要件",
        tasks: [
          task("要件定義", 3, ["ユーザーストーリーを作成", "受け入れ条件を定義"]),
          task("技術調査", 5),
          task("アーキテクチャ設計", 7),
        ],
      },
      {
        name: "実装",
        tasks: [
          task("開発タスクを分解", 8),
          task("実装", 18),
          task("コードレビュー", 20),
        ],
      },
      {
        name: "テスト",
        tasks: [
          task("テスト計画を作成", 12),
          task("結合テストを実施", 23),
          task("受入テストを実施", 26),
        ],
      },
      {
        name: "リリース",
        tasks: [
          task("リリースノートを作成", 28),
          task("本番環境へデプロイ", 30),
          task("リリース後モニタリング", 33),
        ],
      },
    ],
  },
  {
    key: "bug-tracking",
    name: "バグ追跡",
    description: "バグの報告から修正・確認までを一元管理",
    category: "エンジニアリング",
    color: TEMPLATE_COLORS.coral,
    icon: "board",
    sections: [
      {
        name: "受付",
        tasks: [
          task("バグを報告", 0, ["再現手順を記載", "期待する動作と実際の動作を記載"]),
          task("再現手順を確認", 1),
          task("優先度を設定", 2),
        ],
      },
      {
        name: "対応中",
        tasks: [
          task("担当者を割り当て", 2),
          task("修正を実装", 5),
          task("修正内容を共有", 6),
        ],
      },
      {
        name: "確認",
        tasks: [
          task("修正を検証", 8),
          task("回帰テストを実施", 9),
        ],
      },
      {
        name: "完了",
        tasks: [
          task("リリースノートに記載", 10),
          task("再発防止策を検討", 12),
        ],
      },
    ],
  },
  {
    key: "product-launch",
    name: "製品リリース",
    description: "新機能や製品のリリース準備を関係者と進める",
    category: "プロジェクト管理",
    color: TEMPLATE_COLORS.violet,
    icon: "rocket",
    sections: [
      {
        name: "計画",
        tasks: [
          task("リリース目標を設定", 2),
          task("リリーススコープを確定", 4),
          task("KPI を決める", 5),
        ],
      },
      {
        name: "準備",
        tasks: [
          task("リリースノートを作成", 14),
          task("マーケティング資料を準備", 16),
          task("サポート体制を整える", 18),
          task("プレスリリースを準備", 20),
        ],
      },
      {
        name: "リリース",
        tasks: [
          task("最終確認", 25),
          task("本番環境へデプロイ", 26),
          task("リリースを告知", 27),
        ],
      },
      {
        name: "振り返り",
        tasks: [
          task("結果を測定", 34),
          task("振り返りを実施", 36),
        ],
      },
    ],
  },
  {
    key: "okr-planning",
    name: "目標設定（OKR）",
    description: "目標と主要結果を設定し、四半期の進捗を管理",
    category: "プロジェクト管理",
    color: TEMPLATE_COLORS.amber,
    icon: "target",
    sections: [
      {
        name: "設定",
        tasks: [
          task("目標を決める", 3),
          task("主要結果を設定", 5),
          task("チームで合意する", 7),
        ],
      },
      {
        name: "実行",
        tasks: [
          task("マイルストーンを設定", 10),
          task("月次で進捗を確認", 30),
          task("ブロッカーを解消", 45),
        ],
      },
      {
        name: "振り返り",
        tasks: [
          task("達成度を評価", 85),
          task("次の四半期に活かす", 88),
        ],
      },
    ],
  },
  {
    key: "content-calendar",
    name: "コンテンツカレンダー",
    description: "ブログ・SNS・メールなど、コンテンツ制作と配信を計画",
    category: "マーケティング",
    color: TEMPLATE_COLORS.peach,
    icon: "list",
    sections: [
      {
        name: "アイデア",
        tasks: [
          task("テーマを選定", 2),
          task("キーワード調査", 4),
          task("コンテンツ計画を作成", 6),
        ],
      },
      {
        name: "制作",
        tasks: [
          task("記事を執筆", 10),
          task("デザインを作成", 12),
          task("校正・レビュー", 14),
        ],
      },
      {
        name: "配信",
        tasks: [
          task("記事を公開", 15),
          task("SNS で投稿", 16),
          task("メールで配信", 17),
        ],
      },
      {
        name: "分析",
        tasks: [
          task("パフォーマンスを確認", 21),
          task("改善策をまとめる", 24),
        ],
      },
    ],
  },
  {
    key: "marketing-campaign",
    name: "マーケティングキャンペーン",
    description: "ターゲット設定から効果測定まで、キャンペーンを管理",
    category: "マーケティング",
    color: TEMPLATE_COLORS.terracotta,
    icon: "target",
    sections: [
      {
        name: "企画",
        tasks: [
          task("キャンペーン目標を設定", 3),
          task("ターゲットを定義", 4),
          task("メッセージを決める", 6),
          task("予算を確保", 7),
        ],
      },
      {
        name: "制作",
        tasks: [
          task("クリエイティブを制作", 14),
          task("ランディングページを作成", 16),
          task("メール文面を作成", 18),
        ],
      },
      {
        name: "配信",
        tasks: [
          task("媒体を手配", 20),
          task("配信スケジュールを確定", 22),
          task("キャンペーンを公開", 24),
        ],
      },
      {
        name: "分析",
        tasks: [
          task("KPI を確認", 31),
          task("レポートを作成", 33),
          task("改善策を検討", 35),
        ],
      },
    ],
  },
  {
    key: "software-rollout",
    name: "ソフトウェア導入",
    description: "新しいツールの導入計画、移行、トレーニングを管理",
    category: "オペレーション",
    color: TEMPLATE_COLORS.aqua,
    icon: "briefcase",
    sections: [
      {
        name: "現状分析",
        tasks: [
          task("利用部門にヒアリング", 5),
          task("課題を整理", 7),
          task("導入効果を試算", 9),
        ],
      },
      {
        name: "設定",
        tasks: [
          task("アカウントを準備", 14),
          task("既存データを移行", 18),
          task("権限を設定", 20),
        ],
      },
      {
        name: "テスト",
        tasks: [
          task("テスト計画を作成", 22),
          task("パイロット運用", 28),
          task("フィードバックを回収", 30),
        ],
      },
      {
        name: "展開",
        tasks: [
          task("トレーニングを実施", 35),
          task("マニュアルを整備", 36),
          task("本番切り替え", 40),
          task("定着支援", 50),
        ],
      },
    ],
  },
  {
    key: "request-triage",
    name: "リクエスト管理",
    description: "社内外からの依頼を収集し、優先順位をつけて対応",
    category: "オペレーション",
    color: TEMPLATE_COLORS.gray,
    icon: "board",
    sections: [
      {
        name: "受付",
        tasks: [
          task("リクエストを記録", 0),
          task("依頼者に確認", 1),
          task("希望期限を設定", 2),
        ],
      },
      {
        name: "トリアージ",
        tasks: [
          task("影響度を評価", 3),
          task("優先順位を決定", 3),
          task("担当者を割り当て", 4),
        ],
      },
      {
        name: "対応中",
        tasks: [
          task("作業を実施", 8),
          task("進捗を共有", 10),
        ],
      },
      {
        name: "完了",
        tasks: [
          task("完了報告", 12),
          task("満足度を確認", 14),
        ],
      },
    ],
  },
  {
    key: "new-hire-onboarding",
    name: "新入社員オンボーディング",
    description: "入社前から90日後まで、新しいメンバーの立ち上がりを支援",
    category: "人材",
    color: TEMPLATE_COLORS.green,
    icon: "heart",
    sections: [
      {
        name: "入社前",
        tasks: [
          task("アカウントを準備", -5),
          task("歓迎メッセージを送る", -3),
          task("初日の予定を共有", -1),
        ],
      },
      {
        name: "初日",
        tasks: [
          task("オリエンテーション", 0, ["会社紹介", "制度とルールの説明", "セキュリティ研修"]),
          task("チームメンバーを紹介", 0),
          task("開発環境をセットアップ", 1),
        ],
      },
      {
        name: "1週目",
        tasks: [
          task("1on1 を実施", 3),
          task("期待値をすり合わせる", 5),
          task("学習計画を作成", 7),
        ],
      },
      {
        name: "30日",
        tasks: [
          task("最初の成果を出す", 30),
          task("フィードバックを実施", 32),
        ],
      },
      {
        name: "90日",
        tasks: [
          task("目標をレビュー", 90),
          task("今後の成長計画を話す", 92),
        ],
      },
    ],
  },
  {
    key: "meeting-agenda",
    name: "会議の議題",
    description: "アジェンダ、決定事項、アクションアイテムを整理",
    category: "生産性",
    color: TEMPLATE_COLORS.sky,
    icon: "list",
    sections: [
      {
        name: "事前準備",
        tasks: [
          task("アジェンダを作成", 0),
          task("資料を準備", 0),
          task("参加者を招待", 0),
        ],
      },
      {
        name: "会議中",
        tasks: [
          task("議題を進行", 0),
          task("決定事項を記録", 0),
          task("アクションを割り当て", 0),
        ],
      },
      {
        name: "フォローアップ",
        tasks: [
          task("議事録を共有", 1),
          task("アクションの進捗を確認", 3),
        ],
      },
    ],
  },
  {
    key: "one-on-one",
    name: "1on1ミーティング",
    description: "定期的な1on1のアジェンダ、メモ、アクションを管理",
    category: "生産性",
    color: TEMPLATE_COLORS.orchid,
    icon: "heart",
    sections: [
      {
        name: "アジェンダ",
        tasks: [
          task("前回の振り返り", 0),
          task("現在の課題を共有", 0),
          task("キャリアについて相談", 0),
        ],
      },
      {
        name: "メモ",
        tasks: [
          task("話した内容を記録", 0),
          task("フィードバックをまとめる", 0),
        ],
      },
      {
        name: "アクション",
        tasks: [
          task("次回までのアクションを決める", 1),
          task("フォローアップする", 7),
        ],
      },
    ],
  },
];

/** Convert a built-in definition into the same v2 payload used by snapshots. */
export function defaultProjectTemplatePayload(
  template: DefaultProjectTemplate,
): ProjectTemplatePayload {
  return {
    version: 2,
    project: {
      description: template.description,
      color: template.color,
      icon: template.icon,
      status: "active",
      status_color: "none",
      status_options: ["未着手", "進行中", "完了"],
      status_field_name: "Status",
      status_field_enabled: true,
    },
    sections: template.sections,
    custom_fields: [],
  };
}
