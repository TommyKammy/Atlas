"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import type { NotificationDeliveryStatus } from "@/lib/notification-delivery-status";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";
import {
  DEPENDENCY_BUFFER_LABELS,
  DEPENDENCY_BUFFER_MODES,
  DEFAULT_PROJECT_SETTINGS,
  normalizeProjectSettings,
  WEEKDAY_LABELS,
  type DependencyBufferMode,
  type ProjectSettings,
} from "@/lib/project-settings";

type OwnerUser = { id: number; name: string; email?: string | null; is_guest?: boolean };
type Team = { id: number; name: string; description?: string };
type SettingsPayload = {
  notification_delivery?: NotificationDeliveryStatus;
  project: {
    id: number;
    name: string;
    description: string;
    owner_id: number | null;
    team_id: number | null;
    due_on: string | null;
    settings: ProjectSettings;
  };
  teams: Team[];
};

const TABS = [
  { key: "details", label: "プロジェクトの詳細" },
  { key: "dependencies", label: "依存関係" },
  { key: "schedule", label: "スケジュール" },
  { key: "notifications", label: "Notifications" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ProjectSettingsDialog({
  projectId,
  projectName,
  onClose,
  onSaved,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("details");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_PROJECT_SETTINGS);
  const [users, setUsers] = useState<OwnerUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [delivery, setDelivery] = useState<NotificationDeliveryStatus | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [data, directory] = await Promise.all([
          api<SettingsPayload>(`/api/projects/${projectId}/settings`),
          api<{ users?: OwnerUser[] }>("/api/users").catch(() => ({ users: [] })),
        ]);
        if (cancelled) return;
        setName(data.project.name);
        setDescription(data.project.description ?? "");
        setOwnerId(data.project.owner_id === null ? "" : String(data.project.owner_id));
        setTeamId(data.project.team_id === null ? "" : String(data.project.team_id));
        setDueOn(data.project.due_on ?? "");
        setSettings(normalizeProjectSettings(data.project.settings));
        setDelivery(data.notification_delivery ?? null);
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setUsers(Array.isArray(directory?.users) ? directory.users : []);
        setLoaded(true);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshDelivery = async (retry: boolean) => {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    setError("");
    try {
      if (retry) await api(`/api/projects/${projectId}/notifications/retry`, "POST", {});
      const data = await api<SettingsPayload>(`/api/projects/${projectId}/settings`);
      setDelivery(data.notification_delivery ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setDeliveryBusy(false); }
  };

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError("プロジェクト名は必須です。");
      return;
    }
    if (settings.work_hours.start >= settings.work_hours.end) {
      setError("勤務開始は勤務終了より前に設定してください。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}`, "PATCH", {
        name: name.trim(),
        description,
        owner_id: ownerId === "" ? null : Number(ownerId),
        team_id: teamId === "" ? null : Number(teamId),
        due_on: dueOn === "" ? null : dueOn,
        settings,
      });
      toast("プロジェクト設定を保存しました");
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const field =
    "h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/20";

  return (
    <Dialog
      open
      onClose={onClose}
      title="プロジェクト設定"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="flex max-h-[90vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-xl bg-surface text-sm shadow-2xl"
    >
      <div data-project-settings-dialog className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">プロジェクト設定</h2>
            <p className="mt-0.5 text-xs text-muted">{projectName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-xl leading-none text-subtle hover:text-secondary"
          >
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-52 shrink-0 border-r border-line bg-neutral-50/60 p-2" aria-label="設定タブ">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                data-project-settings-tab={entry.key}
                aria-current={tab === entry.key ? "page" : undefined}
                onClick={() => setTab(entry.key)}
                className={`flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] ${
                  tab === entry.key
                    ? "bg-surface font-semibold text-text shadow-sm ring-1 ring-neutral-200"
                    : "text-secondary hover:bg-white/70"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <p className="text-sm text-muted">読み込み中…</p>
            ) : (
              <>
                {tab === "details" && (
                  <div className="space-y-4" data-project-settings-panel="details">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-secondary">名前</span>
                      <input value={name} onChange={(event) => setName(event.target.value)} className={field} maxLength={100} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-secondary">説明</span>
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/20"
                        maxLength={5000}
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-secondary">オーナー</span>
                        <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className={field}>
                          <option value="">未設定</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                              {user.is_guest ? "（ゲスト）" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-secondary">関連チーム</span>
                        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className={field}>
                          <option value="">チームなし</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block max-w-xs">
                      <span className="mb-1 block text-xs font-medium text-secondary">期日</span>
                      <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} className={field} />
                    </label>
                    <p className="text-xs text-subtle">プロジェクトのテンプレートとつながっているポートフォリオは今後ここに表示されます。</p>
                  </div>
                )}

                {tab === "dependencies" && (
                  <div className="space-y-2" data-project-settings-panel="dependencies">
                    <p className="mb-3 text-xs text-muted">
                      このプロジェクトにおいて、依存関係にあるタスクの日付をどのように調整するかを選択します。
                    </p>
                    {DEPENDENCY_BUFFER_MODES.map((mode) => (
                      <label
                        key={mode}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                          settings.dependency_buffer === mode
                            ? "border-[#4075cf] bg-[#f4f8ff]"
                            : "border-line hover:bg-neutral-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="dependency-buffer"
                          checked={settings.dependency_buffer === mode}
                          onChange={() =>
                            setSettings((current) => ({
                              ...current,
                              dependency_buffer: mode as DependencyBufferMode,
                            }))
                          }
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-medium text-text">{DEPENDENCY_BUFFER_LABELS[mode]}</span>
                          <span className="block text-xs text-muted">
                            {mode === "buffer"
                              ? "依存関係にあるタスク同士の間隔を維持します。"
                              : mode === "fill"
                                ? "スケジュールの競合が発生しない限り、依存関係にあるタスク同士の間隔を埋めます。"
                                : "スケジュールの競合が発生する場合も、依存関係にあるタスク同士の間隔を無視します。"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {tab === "schedule" && (
                  <div className="space-y-4" data-project-settings-panel="schedule">
                    <p className="text-xs text-muted">
                      このプロジェクトの勤務日を設定して、依存タスクが非勤務日を考慮するようにします。
                    </p>
                    <div>
                      <div className="mb-2 text-xs font-medium text-secondary">勤務日</div>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAY_LABELS.map((label, day) => {
                          const active = settings.work_days.includes(day);
                          return (
                            <button
                              key={label}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setSettings((current) => {
                                  const days = active
                                    ? current.work_days.filter((value) => value !== day)
                                    : [...current.work_days, day].sort((a, b) => a - b);
                                  return { ...current, work_days: days };
                                })
                              }
                              className={`h-9 w-10 rounded-md border text-sm ${
                                active
                                  ? "border-[#4075cf] bg-[#eaf2ff] font-semibold text-accent-text"
                                  : "border-line bg-surface text-muted hover:bg-neutral-50"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid max-w-sm grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-secondary">勤務開始</span>
                        <input
                          type="time"
                          value={settings.work_hours.start}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              work_hours: { ...current.work_hours, start: event.target.value },
                            }))
                          }
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-secondary">勤務終了</span>
                        <input
                          type="time"
                          value={settings.work_hours.end}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              work_hours: { ...current.work_hours, end: event.target.value },
                            }))
                          }
                          className={field}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {tab === "notifications" && (
                  <div className="space-y-3" data-project-settings-panel="notifications">
                    <p className="text-xs text-muted">プロジェクトの更新をどこで受け取るかを選択します。</p>
                    <label className="flex items-start gap-2 rounded-md border border-line p-3">
                      <input
                        type="checkbox"
                        checked={settings.notifications.email}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            notifications: { ...current.notifications, email: event.target.checked },
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium">メール通知</span>
                        <span className="block text-xs text-muted">課題の割り当て・コメント・期日の変更をメールで受け取ります。</span>
                      </span>
                    </label>
                    <div data-notification-email-status={!delivery ? "unknown" : !delivery.smtp_configured ? "unconfigured" : !delivery.worker_running ? "worker_stopped" : "ready"}
                      className="rounded-md border border-line bg-surface-subtle p-3 text-xs text-secondary">
                      <p className="font-medium text-secondary">メールの配信状況</p>
                      <p className="mt-1">{!delivery ? "配信状況を取得できていません。" : !delivery.smtp_configured
                        ? "SMTPまたはアプリの公開URLが未設定のため、メールは未接続です。タスクの変更は保存されます。"
                        : !delivery.worker_running ? "配信ワーカーが動作していません。メール通知は保留中です。"
                          : "SMTP設定があります。実際の接続・受付結果は各メールの送信時に確認します。"}</p>
                      {delivery && <p className="mt-1">SMTP受付済み {delivery.counts.sent ?? 0}件 ／ 保留 {(delivery.counts.pending ?? 0) + (delivery.counts.unconfigured ?? 0) + delivery.source_pending}件 ／ 再試行待ち {delivery.counts.retry ?? 0}件 ／ 失敗 {(delivery.counts.failed ?? 0) + delivery.source_failed}件</p>}
                      <p className="mt-1">未接続中の保留分は、設定後に再試行してください。通知配信機能の導入前に作成された通知は対象外です。</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" disabled={deliveryBusy} onClick={() => void refreshDelivery(false)} className="rounded border px-2 py-1 disabled:opacity-50">配信状況を更新</button>
                        <button type="button" data-notification-email-retry disabled={deliveryBusy || !delivery?.smtp_configured || !delivery.worker_running || !settings.notifications.email}
                          onClick={() => void refreshDelivery(true)} className="rounded border px-2 py-1 disabled:opacity-50">保留・失敗分を再試行（最大100件）</button>
                      </div>
                      {delivery && (delivery.counts.failed ?? 0) + (delivery.counts.retry ?? 0) + delivery.source_failed > 0 && <p className="mt-2">接続切断などで受付結果を確認できない場合、自動または手動の再試行でメールが重複することがあります。</p>}
                    </div>
                    <label className="flex items-start gap-2 rounded-md border border-line p-3">
                      <input
                        type="checkbox"
                        checked={settings.notifications.in_app}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            notifications: { ...current.notifications, in_app: event.target.checked },
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium">アプリ内通知</span>
                        <span className="block text-xs text-muted">受信トレイにプロジェクトの更新を表示します。</span>
                      </span>
                    </label>
                    <div className="rounded-md border border-dashed border-line-strong p-3 text-xs text-muted">
                      <div className="font-medium text-secondary">Slack / Microsoft Teams</div>
                      <p className="mt-1">外部チャンネル連携は未接続です。接続設定は今後追加されます。</p>
                    </div>
                    <p className="text-[11px] text-subtle">
                      保存後に設定が反映されます。アプリ内通知をオフにすると、受信トレイと未読件数から除外します。
                    </p>
                  </div>
                )}
              </>
            )}
            {error && <p className="mt-4 text-xs text-danger">{error}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button
            type="button"
            className={PROJECT_DIALOG_PRIMARY}
            onClick={() => void save()}
            disabled={saving || loading || !loaded}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
