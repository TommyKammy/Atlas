"use client";

import type { FieldDialogState } from "@/lib/use-field-dialog";
import {
  CURRENCY_CHOICES,
  NUMBER_FORMAT_LABELS,
  type ColumnFunction,
  type FieldAccessLevel,
  type NumberFormat,
} from "@/lib/custom-fields";
import {
  checkboxClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  SelectControl,
} from "@/components/ui/form-controls";

const editorBox = "mt-4 rounded-md bg-surface-subtle p-3";
const editorLabel = `mt-2 block ${fieldLabelClass}`;
const gridLabel = "block text-[12px] font-medium text-secondary";
const grid = "mt-1.5 grid grid-cols-2 gap-3";
const previewRow = "mt-2 flex items-center justify-between text-[12px] text-muted";

export function NumberFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { numberFormat, setNumberFormat, decimals, setDecimals, currency, setCurrency, customSuffix, setCustomSuffix, preview } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>数値の表示</div>
      <div className={grid}>
        <label className={gridLabel}>
          フォーマット
          <SelectControl
            containerClassName="mt-1.5"
            value={numberFormat}
            onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
          >
            {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </SelectControl>
        </label>
        <label className={gridLabel}>
          小数桁数
          <input
            type="number"
            min={0}
            max={6}
            value={decimals}
            onChange={(event) =>
              setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
            }
            className={`mt-1.5 ${fieldControlClass}`}
          />
        </label>
        {numberFormat === "currency" && (
          <label className={gridLabel}>
            通貨
            <SelectControl
              containerClassName="mt-1.5"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCY_CHOICES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </SelectControl>
          </label>
        )}
        {numberFormat === "custom" && (
          <label className={gridLabel}>
            ラベル
            <input
              value={customSuffix}
              onChange={(event) => setCustomSuffix(event.target.value)}
              placeholder="例: lbs"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
        )}
      </div>
      <div className={previewRow}>
        <span>例</span>
        <span className="font-medium text-secondary">{preview}</span>
      </div>
      <div className={`mt-1 ${fieldHintClass}`}>
        セクション合計は列メニューの「列の関数」から変更できます。
      </div>
    </div>
  );
}

export function TimerFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { timerFormat, setTimerFormat } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>タイマー</div>
      <label className={editorLabel}>
        フォーマット
        <SelectControl
          containerClassName="mt-1.5"
          value={timerFormat}
          onChange={(event) =>
            setTimerFormat(event.target.value === "decimal_hours" ? "decimal_hours" : "hours_minutes")
          }
        >
          <option value="hours_minutes">00 時間 00 分</option>
          <option value="decimal_hours">0.00 時間</option>
        </SelectControl>
      </label>
      <div className={`mt-1 ${fieldHintClass}`}>
        セルまたはタスク詳細の ▶ で計測を開始し、■ で停止します。
      </div>
    </div>
  );
}

export function TimeTrackingEditor() {
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>タイムトラッキング</div>
      <div className={`mt-1 ${fieldHintClass}`}>
        このタスクのすべてのタイマーの合計時間を表示します。値は自動計算されます。
      </div>
    </div>
  );
}

export function ReferenceFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { projects, sourceProjectIds, setSourceProjectIds } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>参照元のプロジェクト</div>
      <div className={`mt-1 ${fieldHintClass}`}>
        このフィールドからリンクできるタスクのプロジェクトを選択します。
      </div>
      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
        {projects.map((project) => (
          <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-text hover:bg-hover">
            <input
              type="checkbox"
              checked={sourceProjectIds.includes(project.id)}
              onChange={(event) =>
                setSourceProjectIds((current) =>
                  event.target.checked
                    ? [...current, project.id]
                    : current.filter((id) => id !== project.id),
                )
              }
              className={checkboxClass}
            />
            <span className="truncate">{project.name}</span>
          </label>
        ))}
        {projects.length === 0 && <div className="px-1.5 py-2 text-[12px] text-muted">プロジェクトを読み込み中…</div>}
      </div>
    </div>
  );
}

export function LookupFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { referenceFieldId, setReferenceFieldId, lookupFieldId, setLookupFieldId, referenceFields, lookupTargetFields, setRemoteFields } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>ルックアップ</div>
      <label className={editorLabel}>
        参照フィールド
        <SelectControl
          containerClassName="mt-1.5"
          value={referenceFieldId}
          onChange={(event) => {
            setReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
            setLookupFieldId("");
            setRemoteFields([]);
          }}
        >
          <option value="">選択してください</option>
          {referenceFields.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectControl>
      </label>
      <label className={editorLabel}>
        参照先で取得するフィールド
        <SelectControl
          containerClassName="mt-1.5"
          value={lookupFieldId}
          onChange={(event) => setLookupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
        >
          <option value="">選択してください</option>
          {lookupTargetFields.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectControl>
      </label>
      {referenceFields.length === 0 && (
        <div className={`mt-1 ${fieldHintClass}`}>
          先にリファレンスフィールドを作成してください。
        </div>
      )}
    </div>
  );
}

export function RollupFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { rollupSource, setRollupSource, rollupReferenceFieldId, setRollupReferenceFieldId, referenceFields, rollupFieldId, setRollupFieldId, numericFields, remoteFields, setRemoteFields, rollupFunction, setRollupFunction } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>集計</div>
      <label className={editorLabel}>
        集計元
        <SelectControl
          containerClassName="mt-1.5"
          value={rollupSource}
          onChange={(event) => {
            setRollupSource(event.target.value === "reference" ? "reference" : "subtasks");
            setRollupFieldId("");
          }}
        >
          <option value="subtasks">サブタスク</option>
          <option value="reference">リファレンス先のタスク</option>
        </SelectControl>
      </label>
      {rollupSource === "reference" && (
        <label className={editorLabel}>
          参照フィールド
          <SelectControl
            containerClassName="mt-1.5"
            value={rollupReferenceFieldId}
            onChange={(event) => {
              setRollupReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
              setRollupFieldId("");
              setRemoteFields([]);
            }}
          >
            <option value="">選択してください</option>
            {referenceFields.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectControl>
        </label>
      )}
      <div className={grid}>
        <label className={gridLabel}>
          集計するフィールド
          <SelectControl
            containerClassName="mt-1.5"
            value={rollupFieldId}
            onChange={(event) => setRollupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
          >
            <option value="">選択してください</option>
            {(rollupSource === "subtasks" ? numericFields.filter((item) => item.field_type === "number") : remoteFields.filter((item) => item.field_type === "number")).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectControl>
        </label>
        <label className={gridLabel}>
          関数
          <SelectControl
            containerClassName="mt-1.5"
            value={rollupFunction}
            onChange={(event) => setRollupFunction(event.target.value as ColumnFunction)}
          >
            <option value="sum">合計</option>
            <option value="average">平均</option>
            <option value="count">個数</option>
            <option value="min">最小値</option>
            <option value="max">最大値</option>
          </SelectControl>
        </label>
      </div>
    </div>
  );
}

export function FormulaFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { expression, setExpression, numericFields, numberFormat, setNumberFormat, decimals, setDecimals, currency, setCurrency } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>数式</div>
      <label className={editorLabel}>
        計算式
        <input
          value={expression}
          onChange={(event) => setExpression(event.target.value.slice(0, 500))}
          placeholder="例: {123} + {124}"
          data-field-dialog-expression
          className={`mt-1.5 ${fieldControlClass} font-mono`}
        />
      </label>
      {numericFields.length > 0 && (
        <div className="mt-2">
          <div className="text-[12px] text-muted">フィールドを選択（クリックで挿入）</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {numericFields.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setExpression((current) => `${current}${current && !/[+\-*/^(]$/.test(current.trim()) ? " + " : ""}{${item.id}}`)}
                className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-secondary hover:bg-hover"
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={grid}>
        <label className={gridLabel}>
          フォーマット
          <SelectControl
            containerClassName="mt-1.5"
            value={numberFormat}
            onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
          >
            {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </SelectControl>
        </label>
        <label className={gridLabel}>
          小数桁数
          <input
            type="number"
            min={0}
            max={6}
            value={decimals}
            onChange={(event) =>
              setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
            }
            className={`mt-1.5 ${fieldControlClass}`}
          />
        </label>
        {numberFormat === "currency" && (
          <label className={gridLabel}>
            通貨
            <SelectControl
              containerClassName="mt-1.5"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCY_CHOICES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </SelectControl>
          </label>
        )}
      </div>
      <div className={`mt-1 ${fieldHintClass}`}>
        四則演算・括弧・SUM/AVG/MIN/MAX/ROUND/ABS が使えます。空欄の数値フィールドがある場合は「–」になります。
      </div>
    </div>
  );
}

export function AutoIdFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { prefix, setPrefix } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>IDの自動採番</div>
      <label className={editorLabel}>
        プレフィックス
        <input
          value={prefix}
          onChange={(event) => setPrefix(event.target.value.slice(0, 16))}
          placeholder="ID-"
          data-field-dialog-prefix
          className={`mt-1.5 ${fieldControlClass}`}
        />
      </label>
      <div className={previewRow}>
        <span>例</span>
        <span className="font-medium text-secondary">{`${prefix.trim() || "ID-"}1`}</span>
      </div>
      <div className={`mt-1 ${fieldHintClass}`}>
        タスクごとに連番で自動採番されます。値は編集できません。
      </div>
    </div>
  );
}

export function SelectOptionsEditor({ dialog }: { dialog: FieldDialogState }) {
  const { options, setOptions, updateOption } = dialog;
  return (
    <div className="mt-4">
      <div className="text-[12px] font-medium text-secondary">選択肢</div>
      <div className="mt-1.5 space-y-1.5">
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`選択肢 ${index + 1}`}
              className={`min-w-0 flex-1 ${fieldControlClass}`}
            />
            <button
              type="button"
              onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[14px] text-muted hover:bg-hover hover:text-danger"
              aria-label="選択肢を削除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOptions((current) => [...current, ""])}
        className="mt-1 inline-flex h-8 items-center rounded-md px-2 text-[12px] text-secondary hover:bg-hover"
      >
        ＋ 選択肢を追加
      </button>
    </div>
  );
}

export function FieldAccessEditor({ dialog }: { dialog: FieldDialogState }) {
  const { accessLevel, setAccessLevel, editorIds, setEditorIds, users } = dialog;
  return (
    <div className={editorBox}>
      <div className={formSectionTitleClass}>フィールドアクセスと権限</div>
      <label className={editorLabel}>
        このフィールドの値を編集できるユーザー
        <SelectControl
          containerClassName="mt-1.5"
          value={accessLevel}
          onChange={(event) => setAccessLevel(event.target.value as FieldAccessLevel)}
          data-field-access-level
        >
          <option value="everyone">すべてのプロジェクトメンバー</option>
          <option value="admins">プロジェクト管理者のみ</option>
          <option value="custom">特定のユーザー</option>
        </SelectControl>
      </label>
      {accessLevel === "custom" && (
        <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-line-subtle bg-surface p-1.5">
          {users.map((user) => (
            <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-text hover:bg-hover">
              <input
                type="checkbox"
                checked={editorIds.includes(user.id)}
                onChange={(event) =>
                  setEditorIds((current) =>
                    event.target.checked
                      ? [...current, user.id]
                      : current.filter((id) => id !== user.id),
                  )
                }
                className={checkboxClass}
              />
              <span className="truncate">{user.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className={`mt-1 ${fieldHintClass}`}>
        フィールド設定の変更はプロジェクト編集権限を持つユーザーが行えます。
      </div>
    </div>
  );
}
