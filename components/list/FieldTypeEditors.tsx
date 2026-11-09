"use client";

import type { FieldDialogState } from "@/lib/use-field-dialog";
import {
  CURRENCY_CHOICES,
  NUMBER_FORMAT_LABELS,
  type ColumnFunction,
  type FieldAccessLevel,
  type NumberFormat,
} from "@/lib/custom-fields";

export function NumberFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { numberFormat, setNumberFormat, decimals, setDecimals, currency, setCurrency, customSuffix, setCustomSuffix, preview } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">数値の表示</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  フォーマット
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  小数桁数
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
                    }
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  />
                </label>
                {numberFormat === "currency" && (
                  <label className="text-[11px] text-neutral-500">
                    通貨
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    >
                      {CURRENCY_CHOICES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {numberFormat === "custom" && (
                  <label className="text-[11px] text-neutral-500">
                    ラベル
                    <input
                      value={customSuffix}
                      onChange={(event) => setCustomSuffix(event.target.value)}
                      placeholder="例: lbs"
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                  </label>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                <span>例</span>
                <span className="font-medium text-neutral-700">{preview}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                セクション合計は列メニューの「列の関数」から変更できます。
              </div>
            </div>
  );
}

export function TimerFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { timerFormat, setTimerFormat } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">タイマー</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                フォーマット
                <select
                  value={timerFormat}
                  onChange={(event) =>
                    setTimerFormat(event.target.value === "decimal_hours" ? "decimal_hours" : "hours_minutes")
                  }
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="hours_minutes">00 時間 00 分</option>
                  <option value="decimal_hours">0.00 時間</option>
                </select>
              </label>
              <div className="mt-1 text-[10px] text-neutral-400">
                セルまたはタスク詳細の ▶ で計測を開始し、■ で停止します。
              </div>
            </div>
  );
}

export function TimeTrackingEditor() {
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">タイムトラッキング</div>
              <div className="mt-1 text-[10px] text-neutral-400">
                このタスクのすべてのタイマーの合計時間を表示します。値は自動計算されます。
              </div>
            </div>
  );
}

export function ReferenceFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { projects, sourceProjectIds, setSourceProjectIds } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">参照元のプロジェクト</div>
              <div className="mt-1 text-[10px] text-neutral-400">
                このフィールドからリンクできるタスクのプロジェクトを選択します。
              </div>
              <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                {projects.map((project) => (
                  <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-neutral-700 hover:bg-white">
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
                    />
                    <span className="truncate">{project.name}</span>
                  </label>
                ))}
                {projects.length === 0 && <div className="px-1 py-2 text-[11px] text-neutral-400">プロジェクトを読み込み中…</div>}
              </div>
            </div>
  );
}

export function LookupFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { referenceFieldId, setReferenceFieldId, lookupFieldId, setLookupFieldId, referenceFields, lookupTargetFields, setRemoteFields } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">ルックアップ</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                参照フィールド
                <select
                  value={referenceFieldId}
                  onChange={(event) => {
                    setReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
                    setLookupFieldId("");
                    setRemoteFields([]);
                  }}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="">選択してください</option>
                  {referenceFields.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-[11px] text-neutral-500">
                参照先で取得するフィールド
                <select
                  value={lookupFieldId}
                  onChange={(event) => setLookupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="">選択してください</option>
                  {lookupTargetFields.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {referenceFields.length === 0 && (
                <div className="mt-1 text-[10px] text-amber-600">
                  先にリファレンスフィールドを作成してください。
                </div>
              )}
            </div>
  );
}

export function RollupFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { rollupSource, setRollupSource, rollupReferenceFieldId, setRollupReferenceFieldId, referenceFields, rollupFieldId, setRollupFieldId, numericFields, remoteFields, setRemoteFields, rollupFunction, setRollupFunction } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">集計</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                集計元
                <select
                  value={rollupSource}
                  onChange={(event) => {
                    setRollupSource(event.target.value === "reference" ? "reference" : "subtasks");
                    setRollupFieldId("");
                  }}
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                >
                  <option value="subtasks">サブタスク</option>
                  <option value="reference">リファレンス先のタスク</option>
                </select>
              </label>
              {rollupSource === "reference" && (
                <label className="mt-2 block text-[11px] text-neutral-500">
                  参照フィールド
                  <select
                    value={rollupReferenceFieldId}
                    onChange={(event) => {
                      setRollupReferenceFieldId(event.target.value === "" ? "" : Number(event.target.value));
                      setRollupFieldId("");
                      setRemoteFields([]);
                    }}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="">選択してください</option>
                    {referenceFields.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  集計するフィールド
                  <select
                    value={rollupFieldId}
                    onChange={(event) => setRollupFieldId(event.target.value === "" ? "" : Number(event.target.value))}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="">選択してください</option>
                    {(rollupSource === "subtasks" ? numericFields.filter((item) => item.field_type === "number") : remoteFields.filter((item) => item.field_type === "number")).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  関数
                  <select
                    value={rollupFunction}
                    onChange={(event) => setRollupFunction(event.target.value as ColumnFunction)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    <option value="sum">合計</option>
                    <option value="average">平均</option>
                    <option value="count">個数</option>
                    <option value="min">最小値</option>
                    <option value="max">最大値</option>
                  </select>
                </label>
              </div>
            </div>
  );
}

export function FormulaFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { expression, setExpression, numericFields, numberFormat, setNumberFormat, decimals, setDecimals, currency, setCurrency } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">数式</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                計算式
                <input
                  value={expression}
                  onChange={(event) => setExpression(event.target.value.slice(0, 500))}
                  placeholder="例: {123} + {124}"
                  data-field-dialog-expression
                  className="mt-1 h-9 w-full rounded border border-neutral-300 bg-white px-2 font-mono text-[12px] outline-none focus:border-[#4075cf]"
                />
              </label>
              {numericFields.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-neutral-400">フィールドを選択（クリックで挿入）</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {numericFields.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setExpression((current) => `${current}${current && !/[+\-*/^(]$/.test(current.trim()) ? " + " : ""}{${item.id}}`)}
                        className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-blue-50"
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  フォーマット
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  小数桁数
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
                    }
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  />
                </label>
                {numberFormat === "currency" && (
                  <label className="text-[11px] text-neutral-500">
                    通貨
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    >
                      {CURRENCY_CHOICES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                四則演算・括弧・SUM/AVG/MIN/MAX/ROUND/ABS が使えます。空欄の数値フィールドがある場合は「–」になります。
              </div>
            </div>
  );
}

export function AutoIdFieldEditor({ dialog }: { dialog: FieldDialogState }) {
  const { prefix, setPrefix } = dialog;
  return (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">IDの自動採番</div>
              <label className="mt-2 block text-[11px] text-neutral-500">
                プレフィックス
                <input
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value.slice(0, 16))}
                  placeholder="ID-"
                  data-field-dialog-prefix
                  className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                />
              </label>
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                <span>例</span>
                <span className="font-medium text-neutral-700">{`${prefix.trim() || "ID-"}1`}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                タスクごとに連番で自動採番されます。値は編集できません。
              </div>
            </div>
  );
}

export function SelectOptionsEditor({ dialog }: { dialog: FieldDialogState }) {
  const { options, setOptions, updateOption } = dialog;
  return (
            <div className="mt-4">
              <div className="text-[11px] font-medium text-neutral-500">選択肢</div>
              <div className="mt-1 space-y-1">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`選択肢 ${index + 1}`}
                      className="h-8 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                    <button
                      type="button"
                      onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                      className="rounded px-1.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
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
                className="mt-1 rounded px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
              >
                ＋ 選択肢を追加
              </button>
            </div>
  );
}

export function FieldAccessEditor({ dialog }: { dialog: FieldDialogState }) {
  const { accessLevel, setAccessLevel, editorIds, setEditorIds, users } = dialog;
  return (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
            <div className="text-[12px] font-semibold text-neutral-700">フィールドアクセスと権限</div>
            <label className="mt-2 block text-[11px] text-neutral-500">
              このフィールドの値を編集できるユーザー
              <select
                value={accessLevel}
                onChange={(event) => setAccessLevel(event.target.value as FieldAccessLevel)}
                data-field-access-level
                className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
              >
                <option value="everyone">すべてのプロジェクトメンバー</option>
                <option value="admins">プロジェクト管理者のみ</option>
                <option value="custom">特定のユーザー</option>
              </select>
            </label>
            {accessLevel === "custom" && (
              <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto rounded border border-neutral-100 p-1.5">
                {users.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] text-neutral-700 hover:bg-neutral-50">
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
                    />
                    <span className="truncate">{user.name}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-1 text-[10px] text-neutral-400">
              フィールド設定の変更はプロジェクト編集権限を持つユーザーが行えます。
            </div>
          </div>
  );
}
