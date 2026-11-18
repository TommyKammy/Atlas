"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { AdminTeam, AdminUser, TeamMember } from "@/lib/admin-data";
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

  const field = "w-full rounded border border-line-strong px-2 py-1.5 text-sm outline-none focus:border-accent";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">チーム</h2>
          <p className="mt-0.5 text-xs text-muted">
            チームを作成して、メンバーと仕事を整理します。チーム管理者はメンバーを追加・削除できます。
          </p>
        </div>
        <button
          onClick={openCreate}
          data-admin-team-create
          className="rounded bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover"
        >
          チームを作成
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(200px,1.4fr)_140px_120px_150px_120px] gap-3 border-b bg-surface-subtle px-4 py-2 text-xs font-semibold text-muted">
            <span>チーム</span>
            <span>メンバー</span>
            <span>プライバシー</span>
            <span>作成したユーザー</span>
            <span>操作</span>
          </div>
          {teams.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              チームはまだありません。「チームを作成」から追加できます。
            </p>
          )}
          {teams.map((team) => (
            <div
              key={team.id}
              data-team={team.id}
              data-team-name={team.name}
              className="grid grid-cols-[minmax(200px,1.4fr)_140px_120px_150px_120px] items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{team.name}</span>
                  {team.status === "approved" && (
                    <span className="rounded bg-warning-soft px-1 text-[10px] text-warning">認定済み</span>
                  )}
                </span>
                {team.description && (
                  <span className="block truncate text-[11px] text-muted">{team.description}</span>
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
                <span className="ml-1 text-xs text-muted">{team.members.length}</span>
              </span>
              <span className="text-xs text-secondary" title={PRIVACY_HINT[team.privacy]}>
                {PRIVACY_LABEL[team.privacy]}
              </span>
              <span className="truncate text-xs text-muted">{team.created_by_name ?? "–"}</span>
              <span className="flex gap-1 text-xs">
                <button onClick={() => openEdit(team)} className="rounded border px-1.5 py-0.5 hover:bg-hover">
                  編集
                </button>
                <button
                  onClick={() => remove(team)}
                  className="rounded border border-danger-line px-1.5 py-0.5 text-danger hover:bg-danger-soft"
                >
                  削除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="チームを作成"
            data-team-dialog
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{editingId ? "チームを編集" : "チームを新規作成"}</h2>
                <p className="mt-0.5 text-xs text-muted">チームの情報とメンバーを設定します。</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className="rounded p-1 text-muted hover:bg-hover">
                ×
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs text-secondary">
                チーム名
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例:「マーケティング」または「デザイン」"
                  className={`${field} mt-1`}
                  data-team-name-input
                />
              </label>
              <label className="text-xs text-secondary">
                説明
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="チームに関する情報を追加してください"
                  rows={2}
                  className={`${field} mt-1 resize-y`}
                />
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-secondary">メンバー</span>
                  <span className="text-[11px] text-subtle">選択中 {selectedCount} 人</span>
                </div>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="名前またはメールアドレスで絞り込み…"
                  className={`${field} mt-1`}
                  data-team-member-filter
                />
                <div className="mt-2 max-h-48 overflow-y-auto rounded border">
                  {visibleUsers.map((u) => {
                    const selected = members[u.id];
                    return (
                      <div key={u.id} className="flex items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0">
                        <input
                          type="checkbox"
                          checked={selected !== undefined}
                          onChange={() => toggleMember(u.id)}
                          aria-label={`${u.name}をチームに追加`}
                        />
                        <UserAvatar name={u.name} url={u.avatar_url} className="h-6 w-6" textClassName="text-[9px]" />
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <span className="truncate text-[11px] text-subtle">{u.email ?? ""}</span>
                        {selected && (
                          <select
                            value={selected}
                            onChange={(e) =>
                              setMembers((prev) => ({
                                ...prev,
                                [u.id]: e.target.value as "manager" | "member",
                              }))
                            }
                            className="rounded border px-1 py-0.5 text-[11px]"
                          >
                            <option value="member">メンバー</option>
                            <option value="manager">チーム管理者</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="text-xs text-secondary">チームのステータス</span>
                  <div className="mt-1 flex gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={status === "active"} onChange={() => setStatus("active")} />
                      通常
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={status === "approved"} onChange={() => setStatus("approved")} />
                      認定済み
                    </label>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-secondary">チームプライバシー</span>
                  <div className="mt-1 space-y-1 text-sm">
                    {(["public", "private", "approval"] as const).map((value) => (
                      <label key={value} className="flex items-start gap-1.5">
                        <input
                          type="radio"
                          className="mt-0.5"
                          checked={privacy === value}
                          onChange={() => setPrivacy(value)}
                        />
                        <span>
                          {PRIVACY_LABEL[value]}
                          <span className="block text-[11px] text-subtle">{PRIVACY_HINT[value]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded px-3 py-1.5 text-sm text-secondary hover:bg-hover">
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                data-team-save
                className="rounded bg-accent px-4 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
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
