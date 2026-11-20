"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { AdminTeam, AdminUser, TeamMember } from "@/lib/admin-data";
import {
  checkboxClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldLabelClass,
  fieldTextareaClass,
  pillWarningClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallQuietButtonClass,
  smallQuietDangerButtonClass,
} from "./ui/form-controls";
import UserAvatar from "./UserAvatar";

const PRIVACY_LABEL: Record<AdminTeam["privacy"], string> = {
  public: "組織に公開",
  private: "非公開",
  approval: "承認制",
};

const PRIVACY_HINT: Record<AdminTeam["privacy"], string> = {
  public: "すべてのメンバーが参加できます",
  private: "招待されたメンバーだけが参加できます",
  approval: "参加には承認が必要です",
};

const TEAM_GRID =
  "grid grid-cols-[minmax(200px,1.4fr)_140px_120px_150px_140px] items-center gap-3";

type MemberState = Record<number, "manager" | "member">;

function membersToState(members: TeamMember[]): MemberState {
  const state: MemberState = {};
  for (const member of members) state[member.id] = member.role;
  return state;
}

export default function TeamsPanel({
  initialTeams,
  users,
}: {
  initialTeams: AdminTeam[];
  users: AdminUser[];
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<AdminTeam["privacy"]>("public");
  const [status, setStatus] = useState<AdminTeam["status"]>("active");
  const [members, setMembers] = useState<MemberState>({});
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const activeUsers = users.filter((u) => !u.deactivated_at);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrivacy("public");
    setStatus("active");
    setMembers({});
    setFilter("");
    setMsg("");
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (team: AdminTeam) => {
    setEditingId(team.id);
    setName(team.name);
    setDescription(team.description);
    setPrivacy(team.privacy);
    setStatus(team.status);
    setMembers(membersToState(team.members));
    setFilter("");
    setMsg("");
    setOpen(true);
  };

  const toggleMember = (userId: number) => {
    setMembers((prev) => {
      const next = { ...prev };
      if (next[userId]) delete next[userId];
      else next[userId] = "member";
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const payload = {
      name,
      description,
      privacy,
      status,
      members: Object.entries(members).map(([userId, role]) => ({
        user_id: Number(userId),
        role,
      })),
    };
    try {
      const data = editingId
        ? await api<{ teams: AdminTeam[] }>(`/api/admin/teams/${editingId}`, "PATCH", payload)
        : await api<{ teams: AdminTeam[] }>("/api/admin/teams", "POST", payload);
      setTeams(data.teams);
      setOpen(false);
      resetForm();
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (team: AdminTeam) => {
    if (!(await confirmAction(`チーム「${team.name}」を削除しますか？`))) return;
    try {
      const data = await api<{ teams: AdminTeam[] }>(`/api/admin/teams/${team.id}`, "DELETE");
      setTeams(data.teams);
    } catch (e) {
      setMsg(`削除に失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };

  const selectedCount = Object.keys(members).length;
  const visibleUsers = activeUsers.filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  return (
    <section data-admin-panel="teams">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-6 text-text">チーム</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">
            チームを作成して、メンバーと仕事を整理します。チーム管理者はメンバーを追加・削除できます。
          </p>
        </div>
        <button onClick={openCreate} data-admin-team-create className={primaryButtonClass}>
          チームを作成
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`${TEAM_GRID} border-b border-line px-2 py-2 text-[12px] font-medium text-muted`}>
            <span>チーム</span>
            <span>メンバー</span>
            <span>プライバシー</span>
            <span>作成したユーザー</span>
            <span>操作</span>
          </div>
          {teams.length === 0 && (
            <p className="px-2 py-8 text-center text-[13px] text-muted">
              チームはまだありません。「チームを作成」から追加できます。
            </p>
          )}
          {teams.map((team) => (
            <div
              key={team.id}
              data-team={team.id}
              data-team-name={team.name}
              className={`${TEAM_GRID} min-h-[44px] border-b border-line-subtle px-2 py-2 text-[13px] hover:bg-hover`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-text">{team.name}</span>
                  {team.status === "approved" && <span className={pillWarningClass}>認定済み</span>}
                </span>
                {team.description && (
                  <span className="block truncate text-[12px] text-muted">{team.description}</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <span className="flex -space-x-1">
                  {team.members.slice(0, 4).map((member) => (
                    <UserAvatar
                      key={member.id}
                      name={member.name}
                      url={member.avatar_url}
                      className="h-6 w-6 ring-2 ring-on-strong"
                      textClassName="text-[9px]"
                    />
                  ))}
                </span>
                <span className="ml-1 text-[12px] tabular-nums text-muted">{team.members.length}</span>
              </span>
              <span className="text-[12px] text-secondary" title={PRIVACY_HINT[team.privacy]}>
                {PRIVACY_LABEL[team.privacy]}
              </span>
              <span className="truncate text-[12px] text-muted">{team.created_by_name ?? "–"}</span>
              <span className="flex flex-wrap items-center gap-1">
                <button
                  onClick={() => openEdit(team)}
                  title={`${team.name}を編集`}
                  className={smallQuietButtonClass}
                >
                  編集
                </button>
                <button
                  onClick={() => remove(team)}
                  title={`${team.name}を削除`}
                  className={smallQuietDangerButtonClass}
                >
                  削除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {msg && <p className="mt-3 text-[12px] text-danger">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="チームを作成"
            data-team-dialog
          >
            <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h2 className={dialogTitleClass}>{editingId ? "チームを編集" : "チームを新規作成"}</h2>
                <p className={dialogSubtitleClass}>チームの情報とメンバーを設定します。</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className={dialogCloseClass}>
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-3">
                <label className="block">
                  <span className={fieldLabelClass}>チーム名</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例:「マーケティング」または「デザイン」"
                    className={`mt-1.5 ${fieldControlClass}`}
                    data-team-name-input
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelClass}>説明</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="チームに関する情報を追加してください"
                    rows={2}
                    className={`mt-1.5 ${fieldTextareaClass}`}
                  />
                </label>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className={fieldLabelClass}>メンバー</span>
                    <span className="text-[12px] tabular-nums text-muted">選択中 {selectedCount} 人</span>
                  </div>
                  <label className="mt-2 block">
                    <span className={fieldLabelClass}>メンバーを絞り込む</span>
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="名前またはメールアドレスで絞り込み…"
                      className={`mt-1.5 ${fieldControlClass}`}
                      data-team-member-filter
                    />
                  </label>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md bg-surface-subtle px-2">
                    {visibleUsers.map((u) => {
                      const selected = members[u.id];
                      return (
                        <div
                          key={u.id}
                          className="flex min-h-[36px] items-center gap-2 border-b border-line-subtle py-1 text-[13px] last:border-b-0"
                        >
                          <input
                            type="checkbox"
                            checked={selected !== undefined}
                            onChange={() => toggleMember(u.id)}
                            aria-label={`${u.name}をチームに追加`}
                            className={checkboxClass}
                          />
                          <UserAvatar name={u.name} url={u.avatar_url} className="h-6 w-6" textClassName="text-[9px]" />
                          <span className="min-w-0 flex-1 truncate">{u.name}</span>
                          <span className="hidden min-w-0 max-w-[40%] truncate text-[12px] text-muted sm:block">{u.email ?? ""}</span>
                          {selected && (
                            <SelectControl
                              value={selected}
                              onChange={(e) =>
                                setMembers((prev) => ({
                                  ...prev,
                                  [u.id]: e.target.value as "manager" | "member",
                                }))
                              }
                              aria-label={`${u.name}のチームでの役割`}
                              className="w-32 shrink-0"
                            >
                              <option value="member">メンバー</option>
                              <option value="manager">チーム管理者</option>
                            </SelectControl>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className={fieldLabelClass}>チームのステータス</span>
                    <div className="mt-1.5 flex gap-3 text-[13px] text-secondary">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          checked={status === "active"}
                          onChange={() => setStatus("active")}
                          className={checkboxClass}
                        />
                        通常
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          checked={status === "approved"}
                          onChange={() => setStatus("approved")}
                          className={checkboxClass}
                        />
                        認定済み
                      </label>
                    </div>
                  </div>
                  <div>
                    <span className={fieldLabelClass}>チームプライバシー</span>
                    <div className="mt-1.5 space-y-1 text-[13px] text-secondary">
                      {(["public", "private", "approval"] as const).map((value) => (
                        <label key={value} className="flex items-start gap-1.5">
                          <input
                            type="radio"
                            className={`mt-0.5 ${checkboxClass}`}
                            checked={privacy === value}
                            onChange={() => setPrivacy(value)}
                          />
                          <span>
                            {PRIVACY_LABEL[value]}
                            <span className="block text-[12px] text-muted">{PRIVACY_HINT[value]}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {msg && <p className="mt-3 text-[12px] text-danger">{msg}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-line-subtle px-5 py-3">
              <button onClick={() => setOpen(false)} className={secondaryButtonClass}>
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                data-team-save
                className={primaryButtonClass}
              >
                {saving ? "保存中…" : editingId ? "変更を保存" : "チームを作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
