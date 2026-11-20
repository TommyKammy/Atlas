"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminRole, AdminUser } from "@/lib/admin-data";
import {
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldHintClass,
  fieldLabelClass,
  formSectionTitleClass,
  pillClass,
  pillSuccessClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallQuietButtonClass,
  smallQuietDangerButtonClass,
  smallSecondaryButtonClass,
} from "./ui/form-controls";
import UserAvatar from "./UserAvatar";

const roleOf = (u: AdminUser) =>
  u.role_key ?? (u.is_admin ? "admin" : u.is_guest ? "guest" : "member");

const MEMBER_GRID =
  "grid grid-cols-[minmax(180px,1fr)_200px_140px_64px_240px] items-center gap-3";

export default function AdminPanel({
  initial,
  currentUserId,
  roles,
  passwordPolicyText,
}: {
  initial: AdminUser[];
  currentUserId: number;
  roles: AdminRole[];
  passwordPolicyText: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initial);
  const [roleOptions, setRoleOptions] = useState(roles);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editRole, setEditRole] = useState("member");
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [invitations, setInvitations] = useState<
    { id: number; email: string; role: string; expires_at: string; url: string }[]
  >([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteResult, setInviteResult] = useState<{ url: string; emailed: boolean; reason: string | null } | null>(null);

  const reloadInvitations = async () => {
    const res = await fetch("/api/admin/invitations");
    if (res.ok) {
      const data = await res.json();
      setInvitations(Array.isArray(data?.invitations) ? data.invitations : []);
    }
  };

  const reload = async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      if (Array.isArray(data.roles)) setRoleOptions(data.roles);
    }
    await reloadInvitations();
    router.refresh();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadInvitations();
  }, []);

  const create = async () => {
    setMsg("");
    try {
      await api("/api/admin/users", "POST", {
        name,
        email,
        title,
        password,
        role,
      });
      setName("");
      setEmail("");
      setTitle("");
      setPassword("");
      setRole("member");
      setMsg("ユーザーを作成しました");
      reload();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const invite = async () => {
    setMsg("");
    setInviteResult(null);
    try {
      const data = await api<{ invitation: { url: string }; emailed?: boolean; mail_reason?: string | null }>(
        "/api/admin/invitations",
        "POST",
        { email: inviteEmail, role: inviteRole },
      );
      setInviteEmail("");
      setInviteResult({
        url: data.invitation.url,
        emailed: data.emailed === true,
        reason: data.mail_reason ?? null,
      });
      setMsg(data.emailed ? "招待メールを送信しました" : "招待を作成しました（SMTP未設定のためリンクを共有してください）");
      await reloadInvitations();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const revokeInvite = async (id: number) => {
    try {
      await api(`/api/admin/invitations/${id}`, "DELETE");
      await reloadInvitations();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const toggleActive = async (u: AdminUser) => {
    try {
      await api(`/api/admin/users/${u.id}`, "PATCH", { deactivated: !u.deactivated_at });
      setMsg(u.deactivated_at ? "ユーザーを有効化しました" : "ユーザーを無効化しました");
      reload();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const setRoleFor = async (id: number, next: string) => {
    try {
      await api(`/api/admin/users/${id}`, "PATCH", { role: next });
      reload();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setEditName(u.name);
    setEditEmail(u.email ?? "");
    setEditTitle(u.title ?? "");
    setEditAvatar(u.avatar_url ?? "");
    setEditRole(roleOf(u));
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api(`/api/admin/users/${editing.id}`, "PATCH", {
        name: editName,
        email: editEmail,
        title: editTitle,
        avatar_url: editAvatar,
        role: editRole,
      });
      setEditing(null);
      setMsg("ユーザーを更新しました");
      reload();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  const openReset = (u: AdminUser) => {
    setResetting(u);
    setResetPassword("");
    setResetMsg("");
  };

  const saveReset = async () => {
    if (!resetting) return;
    setResetBusy(true);
    setResetMsg("");
    try {
      await api(`/api/admin/users/${resetting.id}`, "PATCH", { password: resetPassword });
      setMsg("パスワードを再設定しました");
      setResetting(null);
      setResetPassword("");
    } catch (e) {
      setResetMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setResetBusy(false);
    }
  };

  const remove = async (id: number, userName: string) => {
    if (!await confirmAction(`「${userName}」を削除しますか？ 担当は外れ、投稿は残ります。`)) return;
    try {
      await api(`/api/admin/users/${id}`, "DELETE");
      setMsg("削除しました");
      reload();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="mt-4">
      <div data-admin-users-table className="overflow-x-auto">
        <div className="min-w-[800px]">
          <div className={`${MEMBER_GRID} border-b border-line px-2 py-2 text-[12px] font-medium text-muted`}>
            <span>名前</span>
            <span>メール</span>
            <span>権限</span>
            <span>未完了</span>
            <span>操作</span>
          </div>
          {users.map((u) => (
            <div
              key={u.id}
              className={`${MEMBER_GRID} min-h-[44px] border-b border-line-subtle px-2 py-1.5 text-[13px] hover:bg-hover ${
                u.deactivated_at ? "bg-surface-subtle opacity-60" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={u.name} url={u.avatar_url} className="h-7 w-7" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="truncate font-medium text-text">{u.name}</span>
                    {u.deactivated_at && <span className={pillClass}>無効</span>}
                    {u.totp_enabled && (
                      <span className={pillSuccessClass} title="二要素認証が有効です">
                        2FA
                      </span>
                    )}
                  </span>
                  {u.title && <span className="block truncate text-[12px] text-muted">{u.title}</span>}
                </span>
              </span>
              <span className="truncate text-[12px] text-muted">{u.email ?? "–"}</span>
              <span>
                <SelectControl
                  value={roleOf(u)}
                  onChange={(e) => setRoleFor(u.id, e.target.value)}
                  disabled={!u.can_manage || u.id === currentUserId}
                  aria-label={`${u.name}の権限`}
                  title={u.id === currentUserId ? "自分自身の権限は変更できません" : undefined}
                >
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key} disabled={r.can_assign === false}>
                      {r.name}
                    </option>
                  ))}
                </SelectControl>
              </span>
              <span className="text-[12px] tabular-nums text-secondary">{u.open_tasks ?? "–"}</span>
              <span className="flex flex-wrap items-center gap-1">
                <button
                  disabled={!u.can_manage}
                  onClick={() => openEdit(u)}
                  aria-label={`${u.name} を編集`}
                  className={smallQuietButtonClass}
                >
                  編集
                </button>
                <button
                  disabled={!u.can_manage}
                  onClick={() => openReset(u)}
                  aria-label={`${u.name} のパスワードを再設定`}
                  className={smallQuietButtonClass}
                >
                  PW
                </button>
                <button
                  onClick={() => toggleActive(u)}
                  disabled={!u.can_manage || u.id === currentUserId}
                  aria-label={u.deactivated_at ? `${u.name} を有効化` : `${u.name} を無効化`}
                  className={smallQuietButtonClass}
                >
                  {u.deactivated_at ? "有効化" : "無効化"}
                </button>
                <button
                  onClick={() => remove(u.id, u.name)}
                  disabled={!u.can_manage || u.id === currentUserId}
                  aria-label={`${u.name} を削除`}
                  className={smallQuietDangerButtonClass}
                >
                  削除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-8 max-w-3xl border-t border-line-subtle pt-5">
        <h2 className={formSectionTitleClass}>ユーザー作成</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelClass}>名前</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名前"
              autoComplete="off"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>メール</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メール"
              type="email"
              autoComplete="off"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>役職（任意）</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="役職（任意）"
              autoComplete="off"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>パスワード</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              type="password"
              autoComplete="new-password"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>権限</span>
            <SelectControl
              containerClassName="mt-1.5"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {roleOptions.map((r) => (
                <option key={r.key} value={r.key} disabled={r.can_assign === false}>
                  {r.name}
                </option>
              ))}
            </SelectControl>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <button onClick={create} className={primaryButtonClass}>
              作成
            </button>
          </div>
        </div>
        <p className={`mt-2 ${fieldHintClass}`}>パスワード要件: {passwordPolicyText}</p>
      </section>
      {msg && <p className="mt-2 text-[12px] text-secondary">{msg}</p>}

      <section className="mt-6 max-w-3xl border-t border-line-subtle pt-5">
        <h2 className={formSectionTitleClass}>メール招待</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
          <label className="block">
            <span className={fieldLabelClass}>招待するメールアドレス</span>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="招待するメールアドレス"
              type="email"
              autoComplete="off"
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>権限</span>
            <SelectControl
              containerClassName="mt-1.5"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {roleOptions
                .filter((r) => ["member", "guest", "admin"].includes(r.key))
                .map((r) => (
                  <option key={r.key} value={r.key} disabled={r.can_assign === false}>
                    {r.name}
                  </option>
                ))}
            </SelectControl>
          </label>
          <button onClick={invite} className={primaryButtonClass}>
            招待
          </button>
        </div>
        {inviteResult && (
          <div className="mt-3 rounded-md bg-surface-subtle p-3 text-[12px]">
            <div className="font-medium text-text">
              {inviteResult.emailed ? "招待メールを送信しました" : "SMTP未設定: 下のリンクを招待者に共有してください"}
            </div>
            <div className="mt-2">
              <span className={fieldLabelClass}>招待リンク</span>
              <div className="mt-1.5 flex gap-2">
                <input
                  readOnly
                  value={inviteResult.url}
                  aria-label="招待リンク"
                  className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
                />
                <button
                  onClick={() => navigator.clipboard?.writeText(inviteResult.url).catch(() => undefined)}
                  className={smallSecondaryButtonClass}
                >
                  コピー
                </button>
              </div>
            </div>
            {inviteResult.reason && <div className="mt-1 text-muted">{inviteResult.reason}</div>}
          </div>
        )}
      </section>

      <section className="mt-6 max-w-3xl">
        <h2 className={formSectionTitleClass}>保留中の招待</h2>
        <div className="mt-2">
          {invitations.length === 0 && <p className="text-[13px] text-muted">保留中の招待はありません。</p>}
          {invitations.map((inv) => (
            <div
              key={inv.id}
              className="flex min-h-[40px] flex-wrap items-center gap-2 border-b border-line-subtle py-1.5 text-[12px]"
            >
              <span className="min-w-0 flex-1 truncate text-secondary">
                {inv.email} ・ {inv.role === "admin" ? "管理者" : inv.role === "guest" ? "ゲスト" : "メンバー"} ・ 期限{" "}
                <span className="tabular-nums">{inv.expires_at.slice(0, 10)}</span>
              </span>
              <button
                onClick={() => navigator.clipboard?.writeText(inv.url).catch(() => undefined)}
                className={`${smallQuietButtonClass} shrink-0`}
              >
                リンク
              </button>
              <button
                onClick={() => revokeInvite(inv.id)}
                aria-label={`${inv.email} の招待を取り消す`}
                className={`${smallQuietDangerButtonClass} shrink-0`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onClick={() => setEditing(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ユーザー編集"
            className="w-full max-w-md overflow-hidden rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h2 className={dialogTitleClass}>ユーザー編集</h2>
                <p className={`${dialogSubtitleClass} truncate`}>{editing.name}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="閉じる" className={dialogCloseClass}>
                ×
              </button>
            </div>
            <div className="grid gap-3 p-5">
              <label className="block">
                <span className={fieldLabelClass}>名前</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>メール</span>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>役職</span>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>写真URL</span>
                <input
                  value={editAvatar}
                  onChange={(e) => setEditAvatar(e.target.value)}
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <label className="block">
                <span className={fieldLabelClass}>権限</span>
                <SelectControl
                  containerClassName="mt-1.5"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editing.id === currentUserId}
                >
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key} disabled={r.can_assign === false}>
                      {r.name}
                    </option>
                  ))}
                </SelectControl>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line-subtle px-5 py-3">
              <button onClick={() => setEditing(null)} className={secondaryButtonClass}>
                キャンセル
              </button>
              <button onClick={saveEdit} className={primaryButtonClass}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onClick={() => setResetting(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${resetting.name} のパスワード再設定`}
            className="w-full max-w-md overflow-hidden rounded-xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h2 className={dialogTitleClass}>パスワード再設定</h2>
                <p className={`${dialogSubtitleClass} truncate`}>{resetting.name}</p>
              </div>
              <button type="button" onClick={() => setResetting(null)} aria-label="閉じる" className={dialogCloseClass}>
                ×
              </button>
            </div>
            <div className="p-5">
              <label className="block">
                <span className={fieldLabelClass}>新しいパスワード</span>
                <input
                  autoFocus
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && resetPassword) {
                      e.preventDefault();
                      void saveReset();
                    }
                  }}
                  autoComplete="new-password"
                  className={`mt-1.5 ${fieldControlClass}`}
                />
              </label>
              <p className={`mt-2 ${fieldHintClass}`}>パスワード要件: {passwordPolicyText}</p>
              {resetMsg && <p className="mt-2 text-[12px] text-danger">{resetMsg}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-line-subtle px-5 py-3">
              <button onClick={() => setResetting(null)} className={secondaryButtonClass}>
                キャンセル
              </button>
              <button onClick={saveReset} disabled={resetBusy || !resetPassword} className={primaryButtonClass}>
                {resetBusy ? "保存中…" : "再設定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
