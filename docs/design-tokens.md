# Atlas デザイントークン（配色）

- 対象: `app/globals.css`
- ステータス: **基盤のみ**。コンポーネント（`app/**/*.tsx`, `components/**/*.tsx`）はまだ移行していない。
- この段階の受け入れ条件は「見た目を一切変えないこと」。そのため、既存の `html[data-theme="dark"] .bg-white { … }` などの上書きルール（約94個）は**まだ削除していない**。
- Tailwind CSS v4 の `@theme inline` を使っている。

## 1. 定義場所とテーマ切替

| テーマ | 定義場所 |
|---|---|
| ライト | `:root` |
| ダーク | `html[data-theme="dark"]` |

テーマは `<html data-theme="dark">` で切り替える（`color-scheme` も同じブロックで設定）。値はすべて CSS 変数 `--atlas-*` で定義し、Tailwind の色ユーティリティ（`--color-*`）から参照している。

```css
:root {
  --atlas-surface: #ffffff;
}

html[data-theme="dark"] {
  --atlas-surface: #242424;
}

@theme inline {
  --color-surface: var(--atlas-surface);
}
```

`@theme inline` に登録しているため、`bg-surface` などのユーティリティはテーマ変数を直接参照する。テーマ切替時に追加の CSS は不要。

### 互換エイリアス

既存コードとの互換のため、以下は残している。値はトークン参照。

| 旧変数 | 値 |
|---|---|
| `--background` | `var(--atlas-bg)` |
| `--foreground` | `var(--atlas-text)` |
| `--color-background` | `var(--background)`（`bg-background`） |
| `--color-foreground` | `var(--foreground)`（`text-foreground`） |

## 2. 使い方の原則

1. 新規 UI では Tailwind 既定パレット（`neutral-*`, `blue-*`, `red-*` など）や arbitrary hex を直接使わず、意味トークンのユーティリティを使う。
2. 面は `surface` 系、罫線は `line` 系、文字は `text` / `secondary` / `muted` / `subtle` を使い分ける。
3. アクセント色の**文字**には `text-accent-text` を使う。`text-accent` はダーク背景でコントラストが不足する（`#2c60b8` のまま）。
4. ステータス色は「文字・アイコン」と「薄い面」を分けて使う（`text-danger` / `bg-danger-soft` など）。
5. 移行時は、旧クラスを置き換えたうえで、そのクラス専用のダーク上書きルールを削除する。上書きルールを残したままだと、新しいトークン値が上書きされてしまう。
6. 半透明の面（`bg-white/70` など）や画像上の白文字用のトークンはまだない。「未対応」を参照。

### テキスト系ユーティリティ名について

Tailwind の `text-*` ユーティリティと自然に組み合わせるため、Tailwind 側の色名だけ `text-` を外している。CSS 変数名は `--atlas-text-*` のまま。

| CSS 変数 | Tailwind 色名 | 文字ユーティリティ |
|---|---|---|
| `--atlas-text` | `--color-text` | `text-text` |
| `--atlas-text-secondary` | `--color-secondary` | `text-secondary` |
| `--atlas-text-muted` | `--color-muted` | `text-muted` |
| `--atlas-text-subtle` | `--color-subtle` | `text-subtle` |

本文色は `text-text`（互換として `text-foreground` も同じ値）。名前が紛らわしいが、トークン名と 1:1 に対応させるための意図的な命名。

## 3. トークン一覧

ライト側の `oklch(...)` は Tailwind v4 既定パレット（`node_modules/tailwindcss/theme.css`）の値をそのまま使用している。`oklch(...)` で定義したトークンの hex は参考値（sRGB 換算の概算）で、実装値ではない。`#...` で定義したトークンは hex が実装値。ダーク側は既存の `globals.css` 上書きルールの値。

補足: 本番ビルドでは Tailwind の最適化（lightningcss）により `oklch(...)` が hex や `lab(...)` に変換されることがある。ビルド後の `--atlas-*` は Tailwind 既定パレットの `--color-*` と同じ変換結果になる（例: `--atlas-danger` と `--color-red-600` はどちらも `#e40014`）。

| トークン | ユーティリティ例 | ライト | ダーク | 用途 |
|---|---|---|---|---|
| `--atlas-bg` | `bg-bg`（互換: `bg-background`） | `#ffffff` | `#1a1a1a` | ページ全体の背景。`body` に適用済み |
| `--atlas-surface` | `bg-surface` | `#ffffff` | `#242424` | カード・パネル・ポップオーバーなど既定の面 |
| `--atlas-surface-subtle` | `bg-surface-subtle` | `oklch(98.5% 0 none)` ≒ `#fafafa` | `#2a2a2a` | ごく薄い面。ゼブラ、弱い下地 |
| `--atlas-surface-muted` | `bg-surface-muted` | `oklch(97% 0 none)` ≒ `#f5f5f5` | `#303030` | 弱い面。入力欄の下地、選択行 |
| `--atlas-surface-strong` | `bg-surface-strong` | `oklch(92.2% 0 none)` ≒ `#e5e5e5` | `#3a3a3a` | 強い面。押下状態、無効化された面 |
| `--atlas-scrim` | `backdrop:bg-scrim` | `rgb(0 0 0 / 0.25)` | `rgb(0 0 0 / 0.55)` | モーダル背面の暗幕。`::backdrop` 用。値に不透明度を含む |
| `--atlas-line` | `border-line` / `divide-line` / `bg-line` | `#eaeaea` | `#3a3a3a` | 既定の罫線・区切り線。`@layer base` の `border-color` に適用済み |
| `--atlas-line-strong` | `border-line-strong` | `oklch(87% 0 none)` ≒ `#d4d4d4` | `#4a4a4a` | 強調罫線、入力欄の境界 |
| `--atlas-text` | `text-text`（互換: `text-foreground`） | `#171717` | `#ededed` | 既定の本文色。`body` に適用済み |
| `--atlas-text-secondary` | `text-secondary` | `oklch(43.9% 0 none)` ≒ `#525252` | `#cfcfcf` | 副次テキスト。ラベル、説明 |
| `--atlas-text-muted` | `text-muted` | `oklch(55.6% 0 none)` ≒ `#737373` | `#bdbdbd` | 補助テキスト。メタ情報 |
| `--atlas-text-subtle` | `text-subtle` | `oklch(70.8% 0 none)` ≒ `#a1a1a1` | `#a9a9a9` | 最も弱いテキスト。プレースホルダ、無効状態 |
| `--atlas-accent` | `bg-accent` / `border-accent` | `#2c60b8` | `#2c60b8` | アクセントの塗り・線 |
| `--atlas-accent-text` | `text-accent-text` | `#2c60b8` | `#8db8ff` | アクセント色の文字。ダークでは明るい青 |
| `--atlas-accent-soft` | `bg-accent-soft` | `#eff4fd` | `#20344f` | アクセントの薄い面。選択行、情報ボックス |
| `--atlas-danger` | `text-danger` | `oklch(57.7% 0.245 27.325)` ≒ `#e7000b` | `#ff8f8f` | エラーの文字・アイコン |
| `--atlas-danger-soft` | `bg-danger-soft` | `oklch(97.1% 0.013 17.38)` ≒ `#fef2f2` | `#3a2020` | エラーの薄い面 |
| `--atlas-success` | `text-success` | `oklch(52.7% 0.154 150.069)` ≒ `#008236` | `#8fe0a0` | 成功の文字・アイコン |
| `--atlas-success-soft` | `bg-success-soft` | `oklch(96.2% 0.044 156.743)` ≒ `#dcfce7` | `#1e3a2a` | 成功の薄い面 |
| `--atlas-warning` | `text-warning` | `oklch(47.3% 0.137 46.201)` ≒ `#973c00` | `#f0c987` | 警告の文字・アイコン |
| `--atlas-warning-soft` | `bg-warning-soft` | `oklch(98.7% 0.022 95.277)` ≒ `#fffbeb` | `#332a18` | 警告の薄い面 |
| `--atlas-focus-ring` | CSS のみ（`box-shadow`） | `#2c60b8` | `#2c60b8` | キーボードフォーカスのリング。`@layer base` に適用済み |

補足:

- `--atlas-focus-ring` の主用途は CSS の `box-shadow`（Tailwind の色としても登録済みだが、通常の UI では使わない）。
- フォーカス時の白い `outline`（`#ffffff`）はトークン化していない。画像上・アクセント面でも使うため、単純な `surface` では代替できない。
- `bg-bg` はページ背景用。コンポーネントの面には通常 `bg-surface` を使う。
- `--atlas-scrim` は値に不透明度を含む。`backdrop:bg-scrim` として使い、`/25` などの追加の不透明度指定はしない。

## 4. 旧クラス → 新トークン 置き換え表

「一致度」の意味:

- **完全一致**: ライト・ダークともトークン値と一致。ダーク上書きを削除しても見た目は変わらない。
- **ライト差 / ダーク差**: 片方のテーマだけ値が変わる。ダーク上書きの削除タイミングで意図的に確認する。
- **近似**: 両方または主要なテーマで値が変わる。原則として自動置換せず、デザイン判断を行う。

### 4.1 面

| 旧クラス | 新クラス | 一致度 | 備考 |
|---|---|---|---|
| `bg-white` | `bg-surface` | 完全一致 | ダーク上書きは `#242424` |
| `bg-neutral-50` | `bg-surface-subtle` | 完全一致 | |
| `bg-neutral-100` | `bg-surface-muted` | 完全一致 | |
| `bg-neutral-200` | `bg-surface-strong` | 完全一致 | |
| `bg-[#eaeaea]` | `bg-line` | 完全一致 | 罫線用途の面 |
| `bg-[#f5f5f5]` | `bg-surface-muted` または `bg-surface-subtle` | 近似 | ライトは `#f5f5f5`。ダークの旧上書きは `#2a2a2a`（= subtle）で、muted の `#303030` とは異なる。用途で選ぶ |
| `bg-neutral-50/60` | `bg-surface-subtle/60` | 近似 | 半透明の合成結果は同一とは限らない |
| `bg-white/70`, `bg-white/95` | 未対応 | — | 半透明の面トークンがない |
| `bg-white/10`, `bg-white/5` など | 未対応 | — | 画像・色付き面の上のオーバーレイ用 |
| `bg-black/25` | `backdrop:bg-scrim` | ライトは完全一致、ダークは暗さを強めた値 | モーダル背景・オーバーレイ用 |

### 4.2 罫線・区切り

| 旧クラス | 新クラス | 一致度 | 備考 |
|---|---|---|---|
| `border-neutral-200` | `border-line` | ライト差 / ダーク一致 | ライト `#e5e5e5` → `#eaeaea`。ダークは `#3a3a3a` で一致 |
| `border-neutral-300` | `border-line-strong` | 完全一致 | |
| `border-[#eaeaea]` | `border-line` | 完全一致 | |
| `divide-[#eaeaea]` | `divide-line` | 完全一致 | |
| `divide-neutral-200` | `divide-line` | 近似（両テーマ差） | ライトは `#e5e5e5` → `#eaeaea`。ダーク上書きが現状ないためダークでは `#e5e5e5` のままで、`line` の `#3a3a3a` に変わる（移行で改善される） |
| `border-neutral-100` | 未対応 | — | ライト `#f5f5f5` / ダーク `#333333` に対応するトークンがない |
| `border-neutral-400` | 未対応 | — | ライト `#a1a1a1` / ダーク `#5a5a5a` |
| `border-[#e1e1e1]` | 未対応 | — | ライト `#e1e1e1` / ダーク `#3a3a3a` |

### 4.3 文字

| 旧クラス | 新クラス | 一致度 | 備考 |
|---|---|---|---|
| `text-neutral-900` | `text-text` | ライト一致 / ダーク差 | ライト `#171717` は一致。ダーク `#f5f5f5` → `#ededed` |
| `text-neutral-600` | `text-secondary` | 完全一致 | |
| `text-neutral-500` | `text-muted` | 完全一致 | |
| `text-neutral-400` | `text-subtle` | 完全一致 | |
| `text-[#2c60b8]` | `text-accent-text` | 完全一致 | 大文字表記 `text-[#2C60B8]` も同じ |
| `text-[#050505]` | `text-text` | ライト差 / ダーク一致 | ライト `#050505` → `#171717`。ダークは `#ededed` で一致 |
| `text-neutral-800` | 未対応 | — | ライト `#262626` / ダーク `#ebebeb` に対応するトークンがない |
| `text-neutral-700` | 未対応 | — | ライト `#404040` / ダーク `#dedede`。使用数が多く、トークン追加の優先候補 |
| `text-neutral-300` | 未対応 | — | ライト `#d4d4d4` / ダーク `#8f8f8f` |
| `text-white` | 未対応 | — | アクセント面・画像上の文字用（`on-accent` 相当） |
| `text-black` | 未対応 | — | |

### 4.4 アクセント

| 旧クラス | 新クラス | 一致度 | 備考 |
|---|---|---|---|
| `bg-[#2c60b8]` | `bg-accent` | 完全一致 | 大文字表記も同じ |
| `border-[#2c60b8]` | `border-accent` | 完全一致 | |
| `bg-[#eff4fd]` | `bg-accent-soft` | 完全一致 | |
| `text-[#2c60b8]` | `text-accent-text` | 完全一致 | ダークは `#8db8ff` |
| `outline-blue-600` | 未対応 | — | Tailwind の `blue-600` は `#155dfc` 相当で、`accent` の `#2c60b8` とは異なる |
| `border-blue-*`, `bg-blue-*`, `text-blue-*` | 未対応 | — | ブランドのアクセント青とは別の青。対応するトークンがない |

### 4.5 ステータス

| 旧クラス | 新クラス | 一致度 | 備考 |
|---|---|---|---|
| `text-red-600` | `text-danger` | 完全一致 | |
| `bg-red-50` | `bg-danger-soft` | 完全一致 | |
| `text-green-700` | `text-success` | 完全一致 | |
| `bg-green-100` | `bg-success-soft` | 完全一致 | |
| `text-amber-800` | `text-warning` | 完全一致 | |
| `bg-amber-50` | `bg-warning-soft` | 完全一致 | |
| `text-red-500`, `text-red-700`, `text-red-800`, `text-red-900` | 未対応 | — | danger と明度が異なる |
| `bg-red-100`, `bg-red-200`, `border-red-200`, `border-red-300` | 未対応 | — | |
| `text-green-600`, `text-green-800`, `text-green-900`, `bg-green-50`, `bg-green-500`, `bg-green-600`, `bg-green-700`, `bg-green-800` | 未対応 | — | |
| `text-amber-600`, `text-amber-700`, `text-amber-900`, `text-amber-950`, `bg-amber-100`, `bg-amber-200`, `bg-amber-500`, `border-amber-200`, `border-amber-300` | 未対応 | — | |

## 5. 未対応（トークンがないよく使われる色）

以下は 2026-11-17 時点で `app/` と `components/` の TSX を grep した出現数（概算）。移行担当者向けの優先順位付け用。ここにないクラスも、上の対応表になければ未対応。

| 分類 | クラス（出現数の多い順） | 理由 / 最寄りのトークン |
|---|---|---|
| グレー文字 | `text-neutral-700` (267), `text-neutral-800` (137), `text-neutral-300` (29), `text-neutral-200` (6), `text-neutral-100` (1) | 中間の明度に対応するトークンがない。`text-secondary` / `text-muted` では値が変わる |
| グレー罫線 | `border-neutral-100` (95), `border-neutral-400` (9) | `line` / `line-strong` の中間 |
| グレー面 | `bg-neutral-50/60` (10), `bg-neutral-800` (5), `bg-neutral-300` (1), `bg-neutral-400` (3), `bg-neutral-900` (3) | 半透明・濃色面のトークンがない |
| 青 | `bg-blue-50` (43), `text-blue-700` (36), `border-blue-500` (28), `outline-blue-600` (24), `bg-blue-600` (21), `text-blue-800` (17), `border-blue-200` (16), `bg-blue-700` (13), `text-blue-900` (10), `bg-blue-100` (4), `bg-blue-500` (5) | ブランド青（`accent`）とは別系統。`blue-*` 用トークンは未定義 |
| 赤 | `text-red-700` (34), `text-red-500` (5), `bg-red-600` (4), `bg-red-100` (3), `bg-red-200` (3), `border-red-200` (8), `border-red-300` (6), `text-red-800` (2), `text-red-900` (3) | danger の派生色 |
| 緑 | `text-green-800` (13), `bg-green-500` (7), `bg-green-600` (6), `bg-green-50` (6), `bg-green-700` (4), `border-green-700` (4), `border-green-600` (3), `border-green-200` (3) | success の派生色 |
| アンバー | `text-amber-900` (14), `border-amber-200` (12), `text-amber-950` (4), `border-amber-300` (5), `bg-amber-100` (5), `bg-amber-500` (5) | warning の派生色 |
| ローズ | `text-rose-600` (28), `bg-rose-50` (16), `text-rose-700` (11), `border-rose-300` (3), `border-rose-200` (2) | danger に近いが色相が異なる |
| オレンジ | `text-orange-700` (7), `bg-orange-50` (5), `text-orange-800` (5), `border-orange-300` (4) | warning に近いが色相が異なる |
| エメラルド | `bg-emerald-50` (8), `border-emerald-200` (6), `text-emerald-700` (5), `text-emerald-900` (5) | success に近いが色相が異なる |
| その他 | `bg-violet-400` (2), `bg-sky-500` (1), `bg-white/10` (13), `text-white` (121) | アバター・画像オーバーレイ・アクセント面上の文字用 |
| arbitrary hex（青） | `text-[#4075cf]` (65), `bg-[#24529c]` (24), `text-[#24529c]` (24), `bg-[#4075cf]` (20), `bg-[#3567b8]` (17), `border-[#4075cf]` (14), `bg-[#2f6fd0]` (13), `bg-[#2459ad]` (11), `text-[#6d5bd0]` (4), `text-[#2f5fa8]` (4) | アクセント青の濃淡。`accent` / `accent-soft` では代替できない |
| arbitrary hex（グレー） | `border-[#e1e1e1]` (19), `bg-[#f3f3f3]` (7), `bg-[#e1e1e1]` (2), `bg-[#262626]` (2) | 中間のグレー |

再調査用コマンド:

```bash
grep -rhoE "(bg|text|border|divide|ring|outline)-(neutral|red|green|amber|blue|rose|orange|emerald|violet|sky)-[0-9]{2,3}(/[0-9]{1,3})?" app components --include="*.tsx" | sort | uniq -c | sort -rn

grep -rhoE "(bg|text|border|divide|ring|outline)-\[#[0-9a-fA-F]{3,8}\]" app components --include="*.tsx" | sort | uniq -c | sort -rn
```

## 6. 後続タスクの進め方

1. 対応表の「完全一致」から置き換える（例: `bg-white` → `bg-surface`）。
2. 置き換えたクラスに対応する `html[data-theme="dark"] .bg-white` などの上書きルールを削除する。上書きが残っていると、トークン値より優先される。
3. 「ライト差 / ダーク差」のクラスは、両テーマのスクリーンショットを比較してから置き換える。
4. 「未対応」は、トークンを増やすか、既存トークンへ寄せるかをデザイン判断してから着手する。この段階では勝手に新しい色を追加しない。
5. `globals.css` 内の `.atlas-rich-text` や `.knowledge-document` の色は、トークンと完全一致しないため今回は触っていない。リッチテキスト用のトークン設計は別タスク。

### 6.1 旧ダーク上書きと競合するときはトークン化しない

`globals.css` の旧ダーク上書き（例: `html[data-theme="dark"] .text-neutral-400 { color: #a9a9a9; }`）とフォーム要素のルール（`html[data-theme="dark"] input, select, textarea { background-color: #2b2b2b; color: #ededed; }`）は、どちらもレイヤー外（unlayered）にある。unlayered の宣言は `@layer utilities` 内のトークンより常に優先されるため、次の3種類の競合では**競合しているトークンのクラスだけを旧クラスに戻す**。状態付きクラスや旧クラス側は変更しない。

#### 6.1.1 状態付きユーティリティとの競合（variant）

同じ要素のクラス集合に、次の (a) と (b) が同時にある場合。

- (a) 旧クラスにダーク上書きがあるトークン: `bg-surface` / `bg-surface-subtle` / `bg-surface-muted` / `bg-surface-strong` / `bg-line` / `bg-accent-soft` / `bg-danger-soft` / `bg-warning-soft` / `bg-success-soft` / `border-line` / `border-line-strong` / `text-text` / `text-secondary` / `text-muted` / `text-subtle` / `text-accent-text` / `text-danger` / `text-warning` / `text-success`。
- (b) 同じプロパティ（背景色・文字色・枠線色）の状態付きユーティリティ: `hover:` / `focus:` / `focus-visible:` / `focus-within:` / `active:` / `disabled:` / `group-hover:` / `group-focus-within:` / `peer-*:` / `aria-*:` / `data-*:` / `open:` など。`first:` / `last:` / `odd:` / `even:` などの構造系バリアントも、旧上書きに負けていた点は同じなので対象に含める。`placeholder:` は対象外（`::placeholder` の色であり、要素自身の文字色ではないため）。`before:` / `after:` / `backdrop:` / `file:` / `marker:` / `selection:` などの擬似要素系も、要素自身のプロパティではないため対象外。

理由: 移行前はダークで状態付きユーティリティが unlayered の旧上書きに負けていた。トークン（レイヤー内）へ置き換えると、ライトは同じまま、ダークだけ状態付きユーティリティが勝つようになり、ホバー・フォーカス・無効時の見た目が変わる。静止画の比較では写らないため、機械的な検査が必要になる。

#### 6.1.2 同じプロパティの旧クラスとの競合（legacy-overlap）

同じ要素に、トークンのクラスと、同じプロパティ（背景色・文字色・枠線色）の**状態なし**の旧クラスで、`globals.css` に unlayered のダーク上書きがあるものが同時に付きうる場合。

例: シェブロンの基底 `text-neutral-500` と、メニューを開いたときだけ付く `text-neutral-700`。移行前はどちらも unlayered で、宣言順（または詳細度）によりダークでは `.text-neutral-700`（#dedede）が勝っていた。片方を `text-muted` / `text-secondary` などのトークンにすると、もう片方の旧クラスの unlayered 上書きが常に勝つため、ダークの色が変わる。条件分岐の片方にだけあるクラスも、同じ分岐で同時に付きうるなら対象。旧クラス同士（例: `text-neutral-500` と `text-neutral-700`）やトークン同士は対象外。

#### 6.1.3 input / select / textarea の要素ルールとの競合（form-control）

JSX の組み込み要素 `<input>` / `<select>` / `<textarea>` に、背景色または文字色のトークンが付いている場合。クラス定数を経由してその要素に渡っているものも含む。

例: `ProjectShareDialog` の読み取り専用 URL 入力の `text-neutral-600`。移行前は旧クラスのダーク上書き `html[data-theme="dark"] .text-neutral-600 { color: #cfcfcf; }` が、要素セレクタのルールより詳細度が高く勝っていた。トークン化するとレイヤー内の宣言になり、unlayered の要素ルールが勝ってダークで `#ededed` になる。`background-color` も同様に `#2b2b2b` になる。

**トークンのダーク値が要素ルールの同じプロパティの値と一致する場合は対象外**。例: `text-text` のダーク値 `#ededed` は要素ルールの `color: #ededed` と同じなので、要素ルールに負けても見た目は変わらない。値は `globals.css` の `html[data-theme="dark"]` ブロックの `--atlas-*` と、`@theme inline` の `--color-*` → `--atlas-*` の対応から解決し、小文字に正規化した値で比較する。解決できないトークンは従来どおり報告する。

枠線色は要素ルールに含まれないため対象外（`border-line` / `border-line-strong` はそのまま）。`placeholder:` などの擬似要素バリアントも、要素自身の色ではないため対象外。

#### 例外（6.1.1 の状態付きクラス）

- **状態付きクラス自体がセマンティックトークンの場合は対象外**。例: `hover:text-text`、`hover:bg-surface-muted`、`hover:text-accent-text`、`focus:border-accent`。トークンはライト・ダークとも `--atlas-*` 変数から解決され、どちらもレイヤー内にあるため、旧クラスの unlayered ダーク上書きが関与しない。対象外にするトークン名は3章の `surface` 系 / `line` 系 / `text` / `secondary` / `muted` / `subtle` / `accent` 系 / `danger`・`warning`・`success` 系 / `focus-ring` / `scrim` など（互換エイリアスの `background` / `foreground` を含む）。
- `bg-accent` / `border-accent` は対象外。旧クラス `bg-[#2c60b8]` / `border-[#2c60b8]` にはダーク上書きがなく、移行前から状態付きユーティリティが効いていた。
- 状態付きクラス自体にレイヤー外のダーク上書きがある場合は、移行前後で見た目が変わらないため対象外。現在は `hover:bg-white` / `hover:bg-neutral-50` / `hover:bg-neutral-100` / `hover:bg-neutral-200` / `hover:text-black` / `hover:text-neutral-700` / `hover:text-neutral-800` の7つ。検査はこの一覧を `globals.css` から読む（ハードコードしない）。

#### 検査

```bash
npm run check:token-variants
```

`scripts/check-token-variants.mjs` が `app/` と `components/` の `.ts` / `.tsx` を TypeScript の構文木で走査し、`className` 属性・`cn()` / `clsx()` 呼び出し・モジュール内のクラス文字列定数を合成して判定する。条件分岐は同時に描画され得る組み合わせごとに評価する。違反があれば `ファイル:行  [種類] 競合クラス  (with トークン / <要素>)` を出力して終了コード 1。種類は `variant` / `legacy-overlap` / `form-control`。CI の `verify` ジョブでも `check:colors` の直後に実行する。既知の見落とし（実行時に組み立てるクラス、他モジュールから import した定数、`divide-line`、`<Input>` などのラッパー越しのクラス、`:where()` / `:not()` を使った要素ルールなど）はスクリプト冒頭のコメントに記載している。

第3段階（パレット切り替え・旧ダーク上書き削除）では、この制約を解く。旧上書きを削除したうえで状態付きクラスもトークン化し、ライト・ダーク両方のホバー・フォーカス・無効状態を意図的に確認して整える。この検査は第1〜2段階の「見た目を変えない」ためのガードであり、第3段階では前提（レイヤー外のダーク上書き）がなくなるため、役割を終えた時点で削除または目的に合わせた検査へ置き換える。

## 7. 今回 `globals.css` で置き換えた箇所

| 箇所 | 変更前 | 変更後 |
|---|---|---|
| `body` の背景 | `var(--background)` | `var(--atlas-bg)` |
| `body` の文字色 | `var(--foreground)` | `var(--atlas-text)` |
| `@layer base` の既定 `border-color`（ライト） | `#eaeaea` | `var(--atlas-line)` |
| `@layer base` の既定 `border-color`（ダーク） | `#3a3a3a` | `var(--atlas-line)` |
| フォーカスリングの `box-shadow` | `#2c60b8` | `var(--atlas-focus-ring)` |

置き換えなかったもの:

- フォーカス時の白い `outline: 2px solid #ffffff`（対応するトークンがない）
- `html[data-theme="dark"] .bg-white { … }` など 約94個のクラス上書き（後の段階で削除するため、値も含めて現状維持）
- `.atlas-rich-text` / `.knowledge-document` 内の色（トークンと完全一致しない）
- タイムラインのスクロールバー色（`#c7c7c7` など。トークンがない）

## 8. 確認の手順

配色をトークンへ置き換えるたびに、次の2点を機械的に確認する。

1. 見た目が意図せず変わっていないこと（ピクセル比較）
2. ライト/ダークの両方で文字のコントラストが悪化していないこと（WCAG AA 監査）

使い捨ての Atlas に対して実行する。`BASE` はループバック（`127.0.0.1` / `localhost` / `[::1]`）以外を拒否する。

```bash
export BASE=http://127.0.0.1:61411
```

### 8.1 スクリーンショットの撮影と比較

```bash
# 変更前
node scripts/ui-visual-capture.mjs /tmp/atlas-ui-before
# 変更後
node scripts/ui-visual-capture.mjs /tmp/atlas-ui-after
# 比較（第3引数を省略すると差分画像は書き出さない）
node scripts/ui-visual-compare.mjs /tmp/atlas-ui-before /tmp/atlas-ui-after /tmp/atlas-ui-diff
```

- 既定のページ: `/`, `/my-tasks`, `/inbox`, `/projects/1?view=list`, `/projects/1?view=board`, `/projects/1?view=timeline`, `/portfolio`, `/search?q=要件`, `/admin`, `/trash`。`ATLAS_UI_PAGES`（カンマ区切り）で上書きできる。
- ライト/ダークの両方を `1440x900`、`ja-JP`、`Asia/Tokyo`、`reducedMotion=reduce`、固定時刻（既定 `2026-11-17T10:00:00+09:00`、`ATLAS_UI_NOW` で変更可）で撮影する。ファイル名は `<ページ名>-<theme>.png`。
- 比較は同名 PNG の画素を比較し、差分画素数と割合を表示する。差分が既定の 0.5% を超える、または片方にしかないファイルがあると終了コード 1。
- `ATLAS_UI_DIFF_RATIO`（既定 `0.005`）で失敗しきい値を、`ATLAS_UI_PIXEL_TOLERANCE`（既定 `0`）で 1 画素あたりの許容差を変更できる。
- 第3引数に差分画像ディレクトリを指定すると、差分画素を赤で強調した PNG を書き出す。

### 8.2 コントラスト監査

```bash
# 現在の違反を JSON で確認し、ベースラインと比較（--check が既定）
node scripts/ui-contrast.mjs

# ベースラインを更新する（公式手順は 8.3 の専用スイート）
node scripts/ui-contrast.mjs --write-baseline
```

- 監査ロジックは `tests/browser/helpers/contrast-audit.mjs` にあり、ブラウザテストとスクリプトで共有する。WCAG の 4.5:1（大きい文字は 3:1）と、半透明の背景を重ねた実効色で判定する。
- 違反の同一性キーは「ページ名、テーマ、文字色、背景色、文字サイズ、太さ」。文言は変わりやすいためキーに含めない。
- `--check` は `tests/fixtures/contrast-baseline.json` にない違反が1件でもあれば終了コード 1。ベースラインにだけ残っている違反は `fixedViolations` として報告する（失敗にはしない）。
- 出力は JSON（`summary.byPageTheme` にページ×テーマ別の件数）。ログインは `ATLAS_UI_EMAIL` / `ATLAS_UI_PASSWORD`（既定は seed の管理者）を使う。

### 8.3 コントラスト回帰テスト（専用スイート）

```bash
# シード直後の新しい隔離スタックで、ui-contrast.spec.ts だけを workers 1 で実行する
bash tests/run-e2e.sh ui-contrast
```

`tests/browser/ui-contrast.spec.ts` が同じ監査をライト/ダークで実行し、ベースラインにない違反があれば失敗する。違反の同一性キーは画面に表示されるデータに依存するため、全件の `bash tests/run-e2e.sh browser` には含めない（他のテストが追加したプロジェクト・タスク・アバター・監査ログでキーが変わる）。`browser` スイートは従来どおり全件を実行するが、このスペックだけは既定で対象外になる。

ベースラインを更新するときは、同じ専用スイートに書き出しモードを指定し、続けて通常モードで成功を確認する。

```bash
ATLAS_UI_CONTRAST_WRITE_BASELINE=1 bash tests/run-e2e.sh ui-contrast
bash tests/run-e2e.sh ui-contrast
```

書き出しモードも通常モードと同じ隔離ガード（スタック名・マーカー・Playwright の誤ターゲット拒否）を通り、`tests/fixtures/contrast-baseline.json` を更新する。手元の使い捨て環境に対して `scripts/ui-contrast.mjs` を直接実行することもできるが、公式のベースラインはシード直後の専用スイートで生成する。

### 8.4 docs を Tailwind の走査対象から外す

`docs/design-tokens.md` に書かれたクラス名（例: `bg-surface-strong`）が生成 CSS に含まれないよう、`app/globals.css` の先頭で次を指定している。

```css
@source not "../docs";
```

ビルド後に `.next/static/chunks/*.css` を検索し、docs にしか存在しないクラスが消えていることを確認する。

```bash
grep -l "bg-surface-strong" .next/static/chunks/*.css   # 何も出力されなければOK
```

Turbopack の Tailwind 走査キャッシュが残っていると、`@source not` を追加した直後のビルドでも docs 由来のクラスが残ることがある。その場合は `.next` を削除してからビルドし直す。

```bash
rm -rf .next && npm run build
```

`text-emerald-700` / `text-emerald-900` などは docs だけでなく実際のコンポーネント（例: `components/ProfileForm.tsx`）でも使われているため、生成 CSS には残る。docs 由来かどうかは、`app/` と `components/` を検索して判断する。

```bash
grep -rn "text-emerald-700" app components --include="*.tsx"
```

## 9. 直書き検査（ラチェット）

トークン移行の間に、コンポーネントへ新しい色の直書きが増えないよう `scripts/check-color-literals.mjs` でファイルごとの件数を監視している。既存の直書きはベースライン（`tests/fixtures/color-literal-baseline.json`）として許容し、件数が増えたファイル、または新しく直書きを持ち込んだファイルがあると失敗する。

```bash
npm run check:colors                 # --check と同じ。ベースラインと比較
node scripts/check-color-literals.mjs --update   # 現状でベースラインを更新
node scripts/check-color-literals.mjs --summary  # 全体・種類別・上位20ファイルを表示
```

- 走査対象は `app/` と `components/` の `.ts` / `.tsx`。テストとフィクスチャは除外する。
- 数えるもの:
  - Tailwind 既定パレットのクラス（`bg-red-500`、`text-neutral-700/50`、`bg-white/70`、`fill-black` など。`shadow-*` を含む）
  - Tailwind の任意値（`[#fff]`、`[#2c60b8]`、`[rgb(...)]`、`[rgba(...)]`、`[hsl(...)]`）
  - 文字列・style 内の 16進カラー（`#fff` / `#ffffff` / `#ffffffff`）
- トークン由来のクラス（`bg-surface`、`text-muted`、`border-line`、`text-accent-text` など）は数えない。
- 件数が減ったファイルは「改善」として表示し、成功扱いにする。`--update` でベースラインを下げる。
- 誤検出を避けるため、`href="#..."` / `src="#..."`、`url(#...)`、HTML 実体参照、`querySelector("#...")` などは除外している。判定の詳細と限界（コメント内の `#fff` は数える、4桁 hex は文字列中では対象外、など）はスクリプト冒頭のコメントに記載している。
- CI の `verify` ジョブで `npm run check:colors` を実行する。意図的に直書きを増やす場合は、理由を添えて `--update` でベースラインを更新する。
- 6.1 の規則に従ってトークンを旧クラスへ戻すと、その分だけ直書きが増える。これは意図した待機（第3段階でトークン化する）なので、`node scripts/check-color-literals.mjs --update` でベースラインを更新し、`npm run check:colors` が通ることを確認する。T15b では、この戻しによって 57 箇所・27 ファイルの件数が増えた。
- 戻した箇所を再度トークン化してしまう事故は、`npm run check:token-variants`（6.1）で検出する。`check:colors` のラチェットは「直書きを増やさない」、`check:token-variants` は「状態付きユーティリティとの競合を作らない」という別の方向から守る。

