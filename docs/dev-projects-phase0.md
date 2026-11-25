# 開発プロジェクト 段階0 設計（課題キーと `start_task`）

- 状態: 設計案（レビューを 2 回反映済み）
- 基準コミット: `main` `49f9583`（最新マイグレーション `0040_mcp_oauth.sql`、MCP ツール 18 個）
- 関連: [mcp.md](mcp.md)、[PRODUCT.md](../PRODUCT.md)

## 1. 目的と、最初のリリースで確かめること

Atlas を Claude Code などのコーディングエージェントからも使える開発基盤にする最初の一歩として、次の 1 点だけを確かめる。

> **人とエージェントが同じ課題を取り違えず、他人の作業を上書きせずに進められるか。**

そのために、最初のリリースでは次の流れが 1 周すること自体を完了条件にする。

```
Web または MCP で起票 → キー（例: ATL-123）が付く → キーで MCP から着手（start_task）
  → ブランチ名 atl-123 で作業 → PR URL を add_comment で記録 → complete_task で完了
```

### 範囲に含めるもの

1. プロジェクトごとの「開発プロジェクト」設定（有効化、キーの接頭辞、着手時の状態）
2. 開発プロジェクトのすべてのタスクに、作成経路に関係なく付く課題キー
3. 既存の MCP ツールでキーを受け付け、結果にキーを含める
4. 新しい書き込みツール `start_task` を 1 つ
5. MCP の作成時の冪等処理の強化（既存の弱点の修正。§7）
6. 画面: 開発プロジェクトのタスク詳細でキーの表示とコピー、⌘K と検索でのキー一致

### 範囲に含めないもの（後の段階）

`create_tasks`（一括起票）、`find_similar_tasks`、Triage と提案の扱い、状態のカテゴリ、ラベル・優先度・見積もりのシステムフィールド、GitHub 連携による状態の自動遷移、`link_pull_request` / `report_progress`、エージェントへの委任、サイクル。重複確認は既存の `list_tasks(query, projectId)` で行い、見つけられなかった例を集めて段階1以降の判断材料にする。

## 2. 現行実装の前提（設計が依存する事実）

| 事実 | 場所 | 設計への影響 |
| --- | --- | --- |
| タスクを直接 `INSERT INTO tasks` する経路が本番コードに 11 か所ある（通常作成、サブタスク、コピー、複製、インポート、テンプレート、フォーム、メール起票、自動化など） | `lib/services/task-create.ts`、`task-write.ts`、`task-copy.ts`、`project-duplicate.ts`、`project-import.ts`、`projects.ts`、`lib/capabilities/task-create*.ts`、`app/api/forms/[id]/submit/route.ts`、`app/api/projects/[id]/email/intake/route.ts`、`app/api/task-templates/[id]/route.ts` | 採番はアプリではなく DB のトリガーで行う（§4） |
| 状態はプロジェクトの `status_options`（順序付きの文字列配列）の値を `tasks.status` に文字列で持つ。既定は `inbox`。改名は `status_renames` と `status_options_version` で扱う | `db/init.sql`、`lib/services/projects.ts` | 着手時の状態は文字列で持ち、改名と削除に追従させる（§6） |
| 完了は `tasks.completed` / `completed_at` で、状態とは別 | `db/init.sql` | `start_task` は完了済みを既定で拒否する |
| タスクの主プロジェクトは `tasks.project_id`。他プロジェクトへの追加（マルチホーム）は `task_project_memberships` | `db/init.sql` | キーは主プロジェクトだけで決める |
| ゴミ箱は `tasks.deleted_at` による論理削除 | `db/init.sql` | 復元してもキーは変わらない（何もしなくてよい） |
| 既存の `auto_id` カスタムフィールドは `MAX+1` を advisory lock で守る遅延採番 | `lib/auto-id.ts` | 課題キーとは独立に残す。方式も流用しない |
| MCP の冪等処理は、処理本体が成功した後に別クエリで応答を記録する | `lib/mcp/idempotency.ts` | 作成の確定と記録を同じトランザクションにする（§7） |
| MCP はユーザーが書いた本文を指示として扱わない契約 | `lib/mcp/tool-definition.ts` の `UNTRUSTED_DATA_NOTE` | キーや設定は構造化データとして返し、本文から操作を導かない |
| DB トリガーの前例がある | `0002`、`0016`、`0017`、`0019` | トリガーで採番する方式は既存の慣行に沿う |

## 3. データモデル（マイグレーション `0041_dev_project_keys.sql`）

`db/init.sql` にも同じ定義を追加する（既存の慣行どおり両方を更新する）。

```sql
-- 開発プロジェクトの設定と、キーの名前空間。project_id が NULL でない行があれば有効。
-- プロジェクトを完全削除しても行は残し（project_id を NULL にする）、
-- 他のプロジェクトへ移したタスクのキーと接頭辞を失わないようにする。
CREATE TABLE dev_projects (
  id             BIGSERIAL PRIMARY KEY,   -- 名前空間 ID
  project_id     BIGINT UNIQUE REFERENCES projects(id) ON DELETE SET NULL,
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prefix         TEXT NOT NULL,           -- 現在の接頭辞（表示用、正規形）
  branch_prefix  TEXT NOT NULL,           -- 有効化時の接頭辞の小文字。以後変えない（§6.2 のブランチ名）
  start_status   TEXT,                    -- NULL なら start_task は状態を変えられない（§6）
  enabled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by     BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- 採番カウンタ。設定行（dev_projects）と分け、採番トリガーがロックするのはこの行だけにする。
-- 状態の改名で dev_projects.start_status を書き換える処理とロックが交差しないようにするため（§4.4）。
CREATE TABLE dev_key_counters (
  namespace_id   BIGINT PRIMARY KEY REFERENCES dev_projects(id) ON DELETE CASCADE,
  next_number    INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

-- 接頭辞の履歴。改名しても旧接頭辞で解決でき、他のプロジェクトは再利用できない。
CREATE TABLE dev_project_prefixes (
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prefix         TEXT NOT NULL CHECK (prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
  namespace_id   BIGINT NOT NULL REFERENCES dev_projects(id) ON DELETE NO ACTION,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, prefix)
);

-- 課題キー。発行元（名前空間）と番号は発行後に変わらない。
CREATE TABLE task_keys (
  task_id        BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  namespace_id   BIGINT NOT NULL REFERENCES dev_projects(id) ON DELETE NO ACTION,
  number         INTEGER NOT NULL CHECK (number > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (namespace_id, number)
);
```

決めたこと:

- **キーの名前空間は発行元の開発プロジェクトに固定する。** 表示するキーは「発行元の現在の接頭辞 + 番号」。タスクを別のプロジェクトへ移しても、キーは変わらない。
  - 代償: 移動後はキーの接頭辞と現在のプロジェクトが一致しない。初版では移動はまれと見て受け入れる。
  - 将来 Linear のように「移動時に新しいキーを発行し、旧キーを転送先として残す」方式へ切り替える場合は、`task_keys` の主キーを `(namespace_id, number)` に変えて `is_primary` 列を足す。既存の行はそのまま旧キーとして使えるため、データを移行し直さずに済む。
- **番号は再利用しない。** `next_number` は増える一方で、完全削除で `task_keys` の行が消えても番号は戻さない。
- **接頭辞は大文字の英数字 2〜10 文字。** 入力は大文字小文字を区別しない（`atl-123` も受け付ける）。ワークスペース内で一意で、旧接頭辞も含めて再利用できない。
- **開発プロジェクトを完全削除した場合**: `dev_projects.project_id` が NULL になるだけで、名前空間と接頭辞は残る。そのため、すでに他のプロジェクトへ移したタスクは、キーを失わない。削除したプロジェクトに残っていたタスクは、既存のガード（`0002`）とゴミ箱の手順に従って削除され、それらのキーは `task_keys` の `ON DELETE CASCADE` で消える。名前空間の行は削除しない。
- **開発プロジェクトの無効化は初版では提供しない。** 無効化した後に再び有効化したときの番号とキーの扱いを決めるのは、実際に必要になってからにする。
- 既存の `auto_id` カスタムフィールドとは独立させる。両方を持つプロジェクトでは、両方が表示される。

## 4. 採番（DB トリガー）

### 4.1 新規作成と、開発プロジェクトへの移動

```sql
CREATE FUNCTION atlas_assign_task_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n INTEGER; ns BIGINT;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NULL; END IF;
  -- §4.2 の有効化と直列化するため、プロジェクト行に明示的に KEY SHARE を取る。
  -- 外部キー確認のトリガーが先に動くかどうか（トリガー名の順序）に依存しない。
  PERFORM 1 FROM projects WHERE id = NEW.project_id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM task_keys WHERE task_id = NEW.id) THEN RETURN NULL; END IF;
  SELECT d.id INTO ns FROM dev_projects d WHERE d.project_id = NEW.project_id;
  IF ns IS NULL THEN RETURN NULL; END IF;  -- 開発プロジェクトではない
  UPDATE dev_key_counters SET next_number = next_number + 1
   WHERE namespace_id = ns
   RETURNING next_number - 1 INTO n;
  INSERT INTO task_keys (task_id, namespace_id, number) VALUES (NEW.id, ns, n)
    ON CONFLICT (task_id) DO NOTHING;   -- §4.2 の有効化と競合した場合
  RETURN NULL;
END $$;

CREATE TRIGGER tasks_assign_key
  AFTER INSERT OR UPDATE OF project_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION atlas_assign_task_key();
```

- 11 ファイル・14 文あるすべての作成経路に加え、今後追加される経路にも漏れなく効く。サブタスクは親と同じ `project_id` で作られるので、サブタスクにもキーが付く。
- 同じ開発プロジェクトへの同時作成は、`dev_key_counters` の行ロックで直列化される。ロックを持つのはそのトランザクションが終わるまでなので、一度に大量の行を作る処理（インポート）は、その間ほかの作成を待たせる。既存の処理はどれも 1 トランザクションで完結するため、許容範囲とする。インポートは行ごとに SAVEPOINT を使っており、失敗した行を戻すとカウンタも一緒に戻る。
- `ON CONFLICT DO NOTHING` で番号を 1 つ消費することがある。番号は連続を保証しない（Linear と同じ）。
- 番号の順序: 一括で作成した場合は INSERT した順になる。表示順と一致する必要はない。
- **開発プロジェクトではないプロジェクトから移ってきたタスク**には、移動先の名前空間で新しくキーを振る（`UPDATE OF project_id`）。すでにキーを持つタスクは振り直さない（名前空間を固定するため）。
- **マルチホーム**: `task_project_memberships` で開発プロジェクトに追加しただけのタスクにはキーを付けない。主プロジェクトだけで決める。
- **`project_id` が NULL の古いサブタスク**: 過去のデータに存在する（`lib/services/task-update.ts` と `lib/api-project-auth.ts` が扱っている）。これらにはキーを付けない。現在の作成経路は親の `project_id` を入れるので、新しく生まれることはない。
- **プロジェクト複製・テンプレートからの作成**: 作られる新しいプロジェクトは開発プロジェクトではない（開発設定は複製しない）ので、キーは付かない。

### 4.2 既存のタスクにまとめてキーを振る（開発プロジェクトの有効化時）

有効化はサービス関数 `enableDevProject` の 1 トランザクションで行う。**プロジェクト行を持ったままタスク行を待つことはしない。**

実装では、手順 1〜3 を DB 関数 `atlas_enable_dev_project`（`0041`）にまとめ、サービス関数 `enableDevProject`（`lib/services/dev-projects.ts`）は権限確認と監査を行ってからこの関数を呼ぶ。ロックの規則を SQL の 1 か所に置き、DB だけのテスト（`tests/dev-project-keys-regressions.mjs`）で直接確かめるためである。

1. `SELECT … FROM projects WHERE id = $1 FOR UPDATE` でプロジェクト行をロックする。
2. 手順 4 でキーを振るタスク（このプロジェクトにあり、キーのないもの）を `FOR KEY SHARE NOWAIT` でロックする。どれかが `FOR UPDATE` で保持されていれば、待たずに `lock_not_available`（55P03）で失敗する。
3. `dev_projects`、`dev_key_counters`、`dev_project_prefixes` を挿入する。
4. 1 文の `INSERT INTO task_keys … SELECT … ON CONFLICT (task_id) DO NOTHING` で、その文の開始時点で主プロジェクトがこのプロジェクトで、キーのないタスク（ゴミ箱内も含む）に `created_at, id` の順で番号を振る。そのあと `next_number` を更新する。

**手順 1 で同時作成との競合を防げる理由**: 採番トリガー（§4.1）は冒頭で `projects` 行に `FOR KEY SHARE` を取り、コミットまで保持する。`FOR UPDATE` はこれと競合する。そのため有効化のトランザクションは、作成中のトランザクションのコミットを待ってから進み、有効化の最中に始まった作成は有効化のコミットを待つ。後者の作成は、コミット済みの `dev_projects` を見てトリガーで採番される。外部キー確認も同じロックを取るが、トリガーの起動順に依存しないよう、トリガー自身で明示的に取る。

**タスク行を待たない理由（デッドロックの回避）**: 既存の経路には、タスク行をロックしてから同じプロジェクトを参照する行を作るものが多い。たとえば繰り返しタスクの完了（`lib/services/task-update.ts`）は、タスクに `FOR UPDATE` を取ってから、`insertNextOccurrence` で次の回のタスクを同じプロジェクトに INSERT する。`projects` を参照するテーブルは 31 あり、どれへの INSERT も外部キー確認で `projects` 行に `FOR KEY SHARE` を取る。一方、手順 4 の INSERT は `task_keys.task_id` の外部キー確認でタスク行に `FOR KEY SHARE` を取り、これは `FOR UPDATE` と競合する。有効化がここで待つと、次のように互いを待ち合う。

- 完了側: タスクの `FOR UPDATE` を持ったまま、次の回の INSERT でプロジェクト行を待つ
- 有効化側: プロジェクト行の `FOR UPDATE` を持ったまま、そのタスク行を待つ

PostgreSQL はこれを検出して片方を中断するが、どちらが中断されるかは決まっていない。利用者の完了操作が失敗しうるため、手順 2 で有効化側だけが失敗するようにする。

- `FOR KEY SHARE NOWAIT` は、`FOR SHARE`（`duplicateTask` の複製元）や `FOR NO KEY UPDATE`（通常の UPDATE、移動）とは競合しない。失敗するのは、誰かが `FOR UPDATE` を持っている短い間だけである。
- 手順 2 のあとは、対象のタスクに他のトランザクションが `FOR UPDATE` を取れず、プロジェクト行のロックにより新しいタスクも作れない。そのため手順 4 で待つことはない。
- キーをすでに持つタスク（他の開発プロジェクトから移ってきたもの）は手順 4 の対象外なので、ロックしない。
- `enableDevProject` は 55P03 のとき、トランザクション全体を短い間隔（50, 150, 400, 1000 ms）でやり直す。それでも失敗すれば `409 dev_project_busy` を返す。

**プロジェクト外への移動と同時に起きた場合**: 手順 4 の文の開始時点で、まだこのプロジェクトにあったタスクには、このプロジェクトのキーが付く。キーの名前空間は発行元に固定する方針なので、「有効化の時点でこのプロジェクトにあった」タスクがこのキーを持つのは、仕様どおりである。移動先も開発プロジェクトなら、移動側のトリガーが同じ `task_id` を INSERT しようとする。この INSERT は `ON CONFLICT DO NOTHING` により、有効化のコミットを待ってから何もせずに終わる。逆に、移動が先にコミットされていれば、そのタスクは手順 4 の対象にならない。

- `FOR NO KEY UPDATE` は `FOR KEY SHARE` と競合しないため使わない。この点をコードのコメントとテストで固定する。
- 初版では、有効化できるのはタスクが 20,000 件以下のプロジェクトに限る。超える場合はエラーにする。ロックを持つ時間に上限を設けるためで、上限は実測して調整する。

### 4.3 不変条件と検査

不変条件: **主プロジェクトが開発プロジェクトであるタスクは、必ずキーを持つ。**

これを確かめる検査 SQL を `test:integrity`（`tests/p0-regressions.sh integrity`）に追加する。違反は 0 件でなければならない。

### 4.4 ロックの順序

| 処理 | 取るロックの順序 |
| --- | --- |
| タスクの作成・移動（トリガー） | `projects`（KEY SHARE）→ `dev_key_counters` → 遅延トリガー `0002` による親タスク（FOR SHARE） |
| 状態の改名（`updateProject`） | `projects`（UPDATE）→ `dev_projects.start_status` → `tasks`（状態の一括 UPDATE） |
| 有効化（`enableDevProject`） | `projects`（FOR UPDATE）→ `tasks`（KEY SHARE NOWAIT。待たない）→ `dev_projects` / `dev_key_counters` |
| タスクの複製（`duplicateTask`）、繰り返しタスクの完了など、タスク行をロックしてから作成する経路 | `tasks`（FOR SHARE / FOR UPDATE）→ `projects`（KEY SHARE）→ `dev_key_counters` |
| 着手（`start_task`、§6.2） | `dev_projects`（FOR SHARE）→ `tasks`（FOR UPDATE） |
| プロジェクトのゴミ箱移動による付け替え | advisory lock → `tasks` → （トリガー）`dev_key_counters` |

- 表には、トリガーが動く前に呼び出し側がすでに持っているロックも含める。新しい経路を追加するときは、この表と照らして順序を確かめる。
- 有効化はタスク行を待たない（NOWAIT で失敗してやり直す）ので、タスク行を先にロックする既存の経路とは循環しない。
- 状態の改名と着手は、どちらも `dev_projects` → `tasks` の順にロックする。
- カウンタを設定行から分けたので、状態の改名とサブタスクの作成が `dev_projects` と `tasks` を逆順にロックしてデッドロックすることはない。
- `updateProject` では、`start_status` の更新を状態の一括 UPDATE より**前**に行う。
- 自動化が 1 つのトランザクションで 2 つの開発プロジェクトにタスクを作る場合、カウンタ行を逆順にロックしてデッドロックになることがありうる。PostgreSQL が検出して片方を中断する（その自動化の実行は失敗する。失敗時の扱いは実装時に確認する）。発生頻度が高ければ、カウンタを ID 順にロックするよう見直す。

## 5. 課題キーの解決（MCP と画面で共通）

`lib/services/task-keys.ts` に次の関数を置く。

- `parseTaskKey(text)`: `^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$` に一致すれば `{ prefix, number }` を返す。
- `resolveTaskRef(actor, ref: number | string, access: "view" | "edit")`: 数値なら従来どおりそのまま返す（既存のエラーの挙動は変えない）。キーなら `dev_project_prefixes` と `task_keys` を引き、**resolver の中で**タスクの閲覧権限まで確かめる。
  - キーが存在しない場合も、存在するが閲覧権限がない場合も、同じ `notFound("task not found")` を返す。
  - 既存の `getTaskDetail` は、存在しない ID に 404、権限がない ID に 403 を返す（`lib/services/queries.ts`）。キーの経路では、この区別を外に見せない。
- `resolveProjectRef(actor, ref: number | string)`: 数値のプロジェクト ID、または接頭辞（旧接頭辞を含む）を受け付ける。接頭辞の場合は resolver の中で閲覧権限を確かめ、存在しない場合と権限がない場合を同じ `notFound("project not found")` にする。
- `taskKeyFor(taskIds[])`: 表示用にまとめてキーを取得する。一覧で N+1 クエリにしないため。

数値 ID の経路で 403 と 404 を区別している既存の挙動を揃えるかどうかは、この段階の範囲外とする（§12）。

実装メモ（PR 2）:

- `parseTaskKey` は PR 1 の `lib/dev-project-keys.ts` にあり、`lib/services/task-keys.ts` はそれを使う。権限を確かめない引き当て（`lookupTaskKey`、`taskKeysFor`、`devSettingsFor`）は `lib/services/task-key-lookup.ts` に分け、読み取りサービス（`queries.ts`）と resolver の循環参照を避ける。
- `resolveTaskRef` の `view` は、読み取りサービスと同じ規則（`requireTaskReadable` = `loadAuthorizedTask`）で確かめる。`authorizeTask` は互換な親タスクのマルチホームを数えないため、数値 ID では読めるサブタスクがキーでは読めない、というずれが起きるからである。`edit` などの書き込みの権限は、書き込みサービスと同じ `requireTaskAccess` で確かめる。
- MCP ツールは、キーや接頭辞で指定されたときだけ、解決後の読み取り（`getTaskDetail` など）で起きた 403・404 も `hidingAccess` で同じ not found に揃える。権限はあるがプロジェクトがアーカイブ済み、といった後段のエラーからも存在が漏れないようにするため。
- `list_tasks` の `query` がキーに完全に一致するときは、キーからタスク ID を引き（権限は確かめない）、検索 SQL の本文一致に `OR t.id = <ID>` を足して順位を最上位にする。可視性やほかの絞り込みは検索 SQL がそのまま適用するので、閲覧権限のないタスクは返らない。
- `get_project` も接頭辞を受け付ける（§8 の表への追加）。

実装メモ（PR 3）:

- 書き込み系ツールも、キーの解決では閲覧権限（`view`）だけを確かめ、編集やコメントの権限は書き込みサービスにそのまま任せる。キーの解決で `edit` を求めると、閲覧はできるが編集できない利用者に「task not found」と答えることになり、存在を知っている相手に誤った情報を返すためである。その場合は数値 ID のときと同じ 403 になる。
- キーと接頭辞は `withIdempotency` より前に解決し、ハッシュは解決後の数値 ID で計算する（`save_task` の `project_id` と `parent_task_id`、`add_comment` の `task_id`）。

## 6. 着手（`start_task`）の仕様

### 6.1 設定: 着手時の状態

`dev_projects.start_status` は、そのプロジェクトの `status_options` の値のどれかでなければならない。

- **改名**: `updateProject` が `status_renames` を適用するとき、同じトランザクションの中で、状態の一括 UPDATE より**前**に `start_status` も新しい名前に書き換える（§4.4）。
- **削除**: `status_options` から消えた場合（改名先がない場合）は `start_status` を NULL にする。人が状態を編集する画面を止めないことを優先し、開発設定の画面に「着手時の状態が未設定」と表示する。
- **ロック**: 上の 2 つと、次の状態フィールドの無効化を行う `updateProject` は、`dev_projects` 行を `FOR UPDATE` でロックしてから更新する（§6.2 の着手と直列化するため）。
- **状態フィールドの無効化**（`status_field_enabled = false`）: `start_status` は残すが、`start_task` は状態を変更しない（§6.2 の手順 7）。

### 6.2 振る舞い

入力:

```ts
{
  task: number | string;          // タスク ID またはキー（例: "ATL-123"）
  reopen?: boolean;               // 完了済みの課題を再開する場合だけ true
  expected_updated_at?: string;   // 既存の書き込みツールと同じ楽観ロック
}
```

既存の `updateTask` は使わない。`updateTask` はトランザクションの外で読み取ってから自分でトランザクションを開くので、ロックしてから判定することができないためである。`lib/services/task-start.ts` に専用の書き込みを置く。

**ロックの手順**: タスク行のロックだけでは、着手時の状態の設定を守れない。たとえば、`start_task` が旧名「進行中」を読んだ直後に改名がコミットされると、改名の一括 UPDATE は、まだ「未着手」のこのタスクを対象にしない。その後で `start_task` が、もう存在しない旧名を書き込んでしまう。そこで 1 トランザクションの中で次の順に進める。

1. タスクの現在の主プロジェクトを、ロックせずに読む。
2. その主プロジェクトの `dev_projects` 行を `FOR SHARE` でロックし、`start_status` を読む。
3. `SELECT … FROM tasks WHERE id = $1 FOR UPDATE` でタスク行をロックする。
4. 主プロジェクトが手順 1 と変わっていないことを確かめる。変わっていたら最初からやり直す（1 回だけ。2 回目も変わっていたら `conflict: task_moved`）。

改名・状態の削除・状態フィールドの無効化を行う `updateProject` も、`dev_projects` 行を `FOR UPDATE` でロックしてから `start_status` とタスクを更新する（§6.1）。こうすると両者は直列化される。

- 改名が先にコミットされた場合: `start_task` は新しい名前を読む。
- `start_task` が先にコミットされた場合: 改名の一括 UPDATE（READ COMMITTED で新しいスナップショットを使う）が、書き込まれた旧名を新しい名前に書き換える。

以降の判定は、ロックを取った後に読んだ値で行う。

1. タスクの解決と権限: §5 で解決し、主プロジェクトの編集権限を確認する。ゴミ箱内なら `not_found`。
2. 開発プロジェクトかどうか: 主プロジェクトが開発プロジェクトでなければ `conflict: not_dev_project`。
3. `expected_updated_at` が指定されていて一致しなければ、既存のツールと同じ競合エラー。
4. 承認タスク: 承認タスク（`lib/task-approval-guard.ts`、`0016`）は通常の完了・完了解除ができないため、`start_task` の対象にしない。`conflict: approval_task`。
5. 担当者:
   - 空なら、認証ユーザー（MCP の `"me"`）を担当者にする。
   - すでに認証ユーザーなら、そのまま（再実行できる）。
   - 他の人なら `conflict: assigned_to_other`。現在の担当者の ID と名前を返し、何も変更しない。
6. 完了状態:
   - 完了済みで `reopen` が true でなければ `conflict: completed`。
   - 繰り返しタスクで、完了したときに次の回がすでに作られている場合は、`reopen` を指定しても `conflict: recurring_completed` とする。再開すると同じ回が 2 つ並ぶため、初版では扱わない。
   - それ以外で `reopen: true` なら、`completed = false`、`completed_at = NULL` にする。
7. 状態:
   - **再開した場合**は、並び順に関係なく `status` を `start_status` にする（「Done」のまま未完了になるのを防ぐ）。ただし `start_status` が設定されていて、状態フィールドが有効な場合に限る。
   - **それ以外**は、次の条件をすべて満たすときだけ `status` を `start_status` にする。
     - `start_status` が設定されている
     - 状態フィールドが有効
     - 現在の状態の `status_options` 内の位置が `start_status` より前、または現在の状態が `status_options` にない（既定の `inbox` など）
   - `status_options` の並び順を進み具合とみなす。こうすることで、レビュー中の課題に `start_task` を再実行しても「進行中」に戻らない。
8. 記録と通知: 変更があった場合だけ、次を行う。変更がなければ何もしない。
   - トランザクションの中で、`task_events`（活動ログ）に `kind = 'started'`、`via = 'mcp'`、`client_name` を記録する。
   - 同じトランザクションの中で、`emitTaskEvent` で `domain_events` に `task.assigned` / `task.status_changed` / 完了解除のイベントを、変更した項目の分だけ発行する。これらは既存の通知と自動化の入口である。
   - 同じトランザクションの中で、`updateTask` と同じ `audit(uid, "task.update", …)` を記録する（MCP 経由であることを含める）。
   - コミット後に、`updateTask` と同じく `runAutomations` を呼び、`notifyTask(taskId)` で開いている Web 画面に変更を伝える。
   - 変更がない再実行では、活動ログ、監査、ドメインイベント、画面への通知のどれも増やさない。

出力:

```ts
{
  task: TaskDetail,               // get_task と同じ形。key を含む
  key: "ATL-123",
  branch_name: "atl-123",         // 名前空間の branch_prefix と番号だけから決める
  changed: { assignee: boolean; status: boolean; reopened: boolean }
}
```

- **ブランチ名の決め方**: `<branch_prefix>-<番号>`。`branch_prefix` は有効化時の接頭辞を小文字にしたもので、以後変えない。接頭辞を `ATL` から `CORE` に改名しても、表示するキーは `CORE-123` になるが、ブランチ名は `atl-123` のまま変わらない。そのため、新旧どちらのキーで `start_task` を呼んでも同じブランチ名が返る。
- **タイトルを使わない理由**: タイトルは日本語が多く、ASCII のスラッグにすると空になりやすい。またタイトルを変えるとスラッグも変わる。
- `start_task` は結果が同じになる操作なので、`idempotency_key` は受け付けない。

実装メモ（PR 4）:

- `lib/services/task-start.ts` の `startTask` が本体で、MCP の `start_task`（`lib/mcp/start-task.ts`）はキーを閲覧権限で解決してから呼ぶ（PR 3 の書き込み系ツールと同じ）。権限は、`requireTaskAccess(..., "edit", { scope: "primary" })` で主プロジェクトの編集権限を確かめる。他のプロジェクトにも入っているタスクでも、着手は開発プロジェクトの課題としての操作なので、主プロジェクトで決める。
- ロックの手順 4 で主プロジェクトが変わっていたときは、トランザクションをロールバックしてロックを手放してから、新しいトランザクションでやり直す。同じトランザクションのままやり直すと、タスク行を持ったまま移動先の `dev_projects` をロックすることになり、§4.4 の順序が逆になって状態の改名とデッドロックしうるためである。
- 事前の `requireTaskAccess` は、その時点の主プロジェクトで確かめているにすぎない。そこでタスクをロックした後に、ロックしたプロジェクトの編集権限を同じトランザクションで確かめ直す。権限の確認の後で、編集できないプロジェクトへ移されたタスクを変更しないためである。
- トランザクションの中で読むもの（`expected_updated_at` の不一致時の `taskConflictSnapshot` を含む）は、すべてトランザクションの接続で読む。プールの接続をもう 1 本取ると、同時に多数の着手が来たときにプールを使い切って止まるためである。
- 競合は `TaskMutationFailure("conflict", ...)` で、`metadata.conflict` に種類（`task_moved` など）を入れる。MCP の結果では `structuredContent.conflict` になる。`expected_updated_at` の不一致は、既存の書き込みと同じ形（`updated_at` と `current`）で返す。
- 状態の判定は `startStatusTarget` に切り出した。`start_status` が `status_options` にない場合（本来は起きない）は状態を変えない。
- 再開では、`updateTask` と同じ `recordTaskCompletion` で `reopened` の活動ログと `task.reopened` を記録する。`started` の活動ログはこれとは別に 1 件記録する。監査の `summary` は、変更した列（`assignee_id`、`completed`、`status`）を並べる。
- 繰り返しタスクで「次の回がすでに作られている」かどうかは、`task_recurrence_occurrences` に完了元として行があるかで判定する。
- `updateProject` は、`status_options` か `status_field_enabled` を変えるときに `dev_projects` 行を `FOR UPDATE` でロックする。`projects` の UPDATE の後、タスクの一括改名の前に行う（§4.4 の順序どおり）。開発プロジェクトでなければ行がないので何もロックしない。
- 自動化は、`updateTask` と同じく状態が変わったときだけ、コミット後に `runAutomations(..., "status_changed")` を呼ぶ。担当者の変更と再開は `domain_events` を通じて通知と新しい自動化に届く。

## 7. MCP の作成時の冪等処理の強化

現状は、`createTask` のトランザクションがコミットした後で `mcp_idempotency.response` を記録する。この間でプロセスが落ちると、予約が古くなった後の再送で、同じタスクがもう一つ作られる。課題キーを導入すると重複が別々のキーとして見えるため、初版で直す。

変更点:

1. **列の追加**: `mcp_idempotency` に `created_task_id BIGINT` を追加する。
2. **挿入と同じトランザクションで記録する**: `createTask` に、挿入と同じトランザクションの中で呼ばれる任意のフック `onInserted(q, taskId)` を追加する。MCP の `save_task` は、このフックで自分の予約行に `created_task_id` を書く（`owner_token` が一致する行だけ）。
   - 書けた行が 0 件なら（予約が他の実行に引き継がれていたら）、例外を出して作成ごとロールバックする。
3. **予約の引き継ぎ条件**: `withIdempotency` の予約 UPSERT で、未完了の予約を引き継ぐ条件に `created_task_id IS NULL` を加える。期限切れ（TTL）の行を引き継ぐときは `created_task_id` も NULL に戻す。
4. **失敗時に予約を消さない**: `run()` が例外を出したときの予約行の DELETE は、`created_task_id IS NULL` の行に限る。作成がコミットされた後に `afterTaskCreated` の監査記録などが失敗しても、記録が消えて再送で重複作成されることがないようにする。
5. **回復処理（読み取りだけ）**: `withIdempotency` に回復用のコールバック `recover(row)` を渡せるようにする（`withIdempotency` は汎用なので、タスクのことは知らない）。
   - 回復は、未完了（`response IS NULL`）で `created_task_id` が入っており、**かつ予約が古くなっている**（`MCP_IDEMPOTENCY_STALE_MINUTES` を超えた）場合だけ行う。古くなっていなければ、元の呼び出しがまだ実行中かもしれないので、従来どおり `409 in progress` を返す。
   - 回復ではタスクを作り直さず、作成後の更新（説明、状態、カスタムフィールド）もやり直さない。やり直すと、その間に人が Web で直した値を古い値で上書きしてしまうためである。
   - 作成済みのタスクの現在の詳細を読み、要求された項目のうち、現在の値が要求と一致しないものを、既存の `failed_updates` と同じ形式で返す（理由は `not_confirmed`）。一致しないのは「適用されなかった」場合と「その後に誰かが直した」場合の両方がありうるため、どちらかは断定しない。必要なら、エージェントが内容を確かめてから `save_task` で更新する。
   - 回復した結果は予約行に記録しない。回復を実行できる主体を 1 つに決める仕組みが要らないようにするためで、回復は何度呼ばれても読み取りしかしない。
6. **リクエストのハッシュ**: `request_hash` は、`project_id` / `parent_task_id` を解決後の数値 ID に正規化してから計算する。`"ATL"` と数値 ID のどちらで再送しても同じ要求として扱う。

`afterTaskCreated`（自動化とイベント）がトランザクションの外で動くことは既存の課題として残し、この段階では扱わない。`create_tasks`（一括起票）は、この仕組みを複数件と親子に広げる設計とあわせて、後の段階で扱う。

実装メモ（PR 3）:

- 列はマイグレーション `0042_mcp_idempotency_created_task.sql` で追加する（`init.sql` にも反映）。外部キーは付けない。予約行は回復のための目印にすぎず、タスクが完全削除されていた場合は、回復の結果で読めなかったことを報告する。
- `withIdempotency(input, run, { recover })` の `run` は、自分の予約への操作 `reservation.recordCreatedTask(q, taskId)` を受け取る。`idempotency_key` がないときは何もしない。`createTask(actor, input, { onInserted })` のフックからこれを呼ぶ。
- 回復の比較は、作成時に要求したすべての項目（`project_id`、`name`、`section_id`、`parent_task_id`、日付、`assignee`、`is_milestone`、`description`、`status`、カスタムフィールド）について行う。カスタムフィールドは、値を書くときと同じ正規化をした値と保存済みの値を比べる（`taskCustomValueMatches`）。結果には `recovered: true` を付け、一致しない項目があれば作成時の部分失敗と同じ形（`created`、`id`、`task`、`failed_updates`、`isError`）で返す。
- 現在の `afterTaskCreated` は、監査記録や自動化の失敗を自分で握りつぶすため、例外はほとんど出ない。コミット後の失敗のテストは、`createTask` がその後に行う `updated_at` の読み取りを失敗させて代用する。

## 8. MCP ツールの変更

共通: タスクを指す引数は `number | string`（キー）を受け付け、タスクを返すすべての出力に `key` を含める。`key` は、キーが発行済みなら、現在どのプロジェクトにあっても発行元の現在の接頭辞によるキー（例: 一般プロジェクトへ移した `ATL-123` は `"ATL-123"`）、発行されていなければ `null` とする。画面でキーを表示するかどうかは、現在の主プロジェクトが開発プロジェクトかどうかで決める（§9）。説明文には、キーの形式と、プロジェクトを接頭辞で指定できることを追記する。

| ツール | 変更 |
| --- | --- |
| `get_task` | `taskId` にキーを受け付ける。出力の `task.key` |
| `list_tasks` | `projectId` に接頭辞を受け付ける。各行に `key`。`query` がキーの形式に完全に一致するときは、そのタスクを先頭に返す |
| `list_my_tasks` | 各行に `key` |
| `save_task` | `id`、`parent_task_id` にキー、`project_id` に接頭辞を受け付ける。作成の冪等処理は §7 |
| `complete_task` / `move_task` / `trash_task` / `add_comment` / `list_comments` | タスクの引数にキーを受け付ける |
| `get_project` / `list_projects` | `dev: { prefix, start_status } \| null`。`get_project` は `projectId` に接頭辞も受け付ける |
| **`start_task`（新規）** | §6。`write` スコープ。`/mcp/readonly` には公開しない |

ツールは 19 個になる。`docs/mcp.md` の表と件数を更新する。

## 9. 画面の変更（最小限）

PRODUCT.md の「日常の画面に専門機能を出さない」に従い、表示は開発プロジェクトだけにする。

- **有効化**: プロジェクト設定に「開発」セクションを追加する。表示するのは、ワークスペースの管理者が「管理 → 機能」で開発プロジェクトを許可している場合で、かつプロジェクトの設定権限を持つ人だけ。接頭辞と着手時の状態を入力して有効化する。接頭辞は後から変えられるが、旧接頭辞も引き続き使えることを画面に明記する。
- **タスク詳細**: 開発プロジェクトのタスクでは、タイトルの上にキーとコピーボタンを表示する。ほかのプロジェクトでは何も表示しない。
- **検索**: ⌘K とプロジェクト内の検索で、キーの形式に完全に一致する入力をそのタスクに直接解決する。
- 一覧の列、ボード、タイムラインは変更しない（段階1で検討する）。

## 10. テストとリリース判定

### 単体・結合テスト（`npm test` と `test:p0`）

- **採番**:
  - 11 の作成経路それぞれで、開発プロジェクトに作ったタスクにキーが付く。ほかのプロジェクトのタスクには付かない
  - 同じプロジェクトへ 50 件を並行に作成しても番号が重複しない
  - 有効化とタスクの作成を並行して実行しても、キーのないタスクが残らない（§4.2）
  - 有効化のロックが `FOR UPDATE` であることを固定するテスト
- **移動**:
  - 開発プロジェクト A から B へ移してもキーは A のまま
  - 開発プロジェクトではないプロジェクトから A へ移すと、A のキーが付く
  - A から開発プロジェクトではないプロジェクトへ移しても、キーで参照できる
- **接頭辞**: 改名後も新旧どちらの接頭辞でも解決できる。旧接頭辞を他のプロジェクトで使うことはできない
- **ゴミ箱、コピー**: ゴミ箱から復元してもキーは同じ。タスクのコピーでは新しい番号が付く。プロジェクトの複製で作られた新しいプロジェクトのタスクには、キーが付かない
- **解決と権限**:
  - キーで指定した場合、存在しないキーと閲覧権限のないタスクのキーとを、エラーから区別できない
  - プロジェクトの接頭辞でも同じ
  - 権限のない利用者の `list_tasks` に、キーで一致するタスクが出ない
- **`start_task`**:
  - 承認タスクは `approval_task`、次の回が作られた繰り返しタスクは `recurring_completed`
  - 「Done」で完了済みの課題を `reopen: true` で再開すると `start_status` に戻る
  - 変更時に `domain_events` が発行され、自動化が動く
  - 担当者が空のとき・自分のとき・他人のときの 3 通り
  - 完了済みで `reopen` を指定しないとき・指定したとき
  - 状態が前・同じ・後ろ・`status_options` にない、の 4 通り
  - `start_status` が NULL のとき、状態フィールドが無効のとき
  - 同じ課題への同時の `start_task` 2 件で、片方だけが担当者になる
  - 再実行しても同じブランチ名を返し、活動ログ・監査・ドメインイベントは増えない
  - 接頭辞を改名した後、新旧どちらのキーで呼んでも同じブランチ名を返す
  - 一般プロジェクトへ移したタスクを旧キーで取得すると、`task.key` は発行時のキー（発行元の現在の接頭辞）になる
- **冪等処理**:
  - コミット直後に応答の記録を失敗させても、再送で作成されるのは 1 件だけ
  - `afterTaskCreated` が例外を出しても同じ
  - 作成後に人が説明を変えてから回復しても、人の変更は上書きされず、`not_confirmed` として報告される
  - 予約が古くなる前の再送は `409 in progress` になり、回復しない
  - 予約を引き継がれた場合は、作成ごとロールバックされる
  - `project_id` を接頭辞と数値 ID のどちらで再送しても、同じ要求として扱われる
- **ロック**:
  - 2 つの接続で「複製元を FOR SHARE → 有効化が projects を FOR UPDATE → 複製の INSERT」の順序を固定しても、複製と有効化の両方が成功し、どちらで作られたタスクにもキーが付く
  - 完了側がタスクを FOR UPDATE で持っている間の有効化は、待たずに 55P03 で失敗する。完了側の次の回の作成は成功し、やり直した有効化で両方にキーが付く
  - 状態の改名・状態の削除・状態フィールドの無効化と `start_task` を、それぞれの順序で並行させても、削除済みの状態名が書き込まれない
  - 状態の改名とサブタスクの作成を並行して繰り返してもデッドロックしない。有効化とプロジェクト外への移動を並行しても、キーの重複や付け間違いが起きない
- **整合性**: §4.3 の検査が 0 件

### リリース判定（検証環境での手動の 1 周）

1. Atlas 自身の開発用に開発プロジェクトを 1 つ有効化する（例: `ATL`）。
2. Web で起票し、詳細画面でキーをコピーする。Claude Code から `get_task("ATL-n")` で取得できる。
3. Claude Code から `save_task(project_id: "ATL")` で起票する。Web の詳細画面に同じキーが表示される。
4. Web でその課題を開いたまま、`start_task` で着手する。再読み込みしなくても、担当者と状態が画面上で切り替わる。もう一度 `start_task` を実行しても、活動ログと監査記録が増えない。`atl-n` ブランチで作業する。PR の URL を `add_comment` で記録し、`complete_task` で完了する。
5. 別の利用者が担当している課題に `start_task` を実行すると競合になり、何も変わらない。

## 11. 実装の順序（PR の分け方の案）

1. **スキーマと採番**: `0041`、`init.sql`、トリガー、`enableDevProject`、整合性の検査、採番のテスト
2. **キーの解決と MCP の読み取り**: `task-keys.ts`、読み取りツールの `key` と入力の拡張
3. **作成時の冪等処理の強化**（§7）と、`save_task` などの書き込みツールのキー対応
4. **`start_task`** と、状態の改名・削除への追従
5. **画面**: 管理画面での許可、プロジェクト設定、タスク詳細のキー、検索、`docs/mcp.md`

1 と 3 は互いに依存しないので、並行して進められる。

## 12. 未決事項

- 開発プロジェクトの許可を、ワークスペースの機能フラグにするか、RBAC の権限（例: `projects.dev.enable`）にするか
- 有効化できるタスク件数の上限値（§4.2。実測して決める）
- 数値 ID の経路で、存在しない場合（404）と権限がない場合（403）を区別している既存の挙動を揃えるか（MCP 全体の情報漏えい対策として別途扱う）
- 段階1で状態のカテゴリを導入したら、`start_task` が「並び順」の代わりにカテゴリで判定するように切り替えるか
