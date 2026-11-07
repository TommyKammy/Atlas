"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@/lib/data";
import UserAvatar from "./UserAvatar";


const roleOf = (u: User) => (u.is_admin ? "admin" : u.is_guest ? "guest" : "member");
export default function AdminPanel({
  initial,
  currentUserId,
}: {
  initial: User[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editRole, setEditRole] = useState("member");
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

  const toggleActive = async (u: User) => {
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

  const openEdit = (u: User) => {
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

  const resetPw = async (id: number, userName: string) => {
    const pw = prompt(`${userName} の新しいパスワード（8文字以上）:`);
    if (!pw) return;
    try {
      await api(`/api/admin/users/${id}`, "PATCH", { password: pw });
      setMsg("パスワードを再設定しました");
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : e}`);
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

  const field = "rounded border px-2 py-1.5 text-sm outline-none focus:border-blue-500";
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(220px,1fr)_220px_150px_80px_280px] gap-2 border-b px-2 py-2 text-xs font-semibold text-neutral-500">
            <span>名前</span>
            <span>メール</span>
            <span>権限</span>
            <span>未完了</span>
            <span>操作</span>
          </div>
          {users.map((u) => (
            <div
              key={u.id}
              className={`grid grid-cols-[minmax(220px,1fr)_220px_150px_80px_280px] items-center gap-2 border-b px-2 py-1.5 text-sm ${
                u.deactivated_at ? "bg-neutral-50 opacity-60" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={u.name} url={u.avatar_url} className="h-7 w-7" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1">
                    <span className="truncate font-medium">{u.name}</span>
                    {u.deactivated_at && (
                      <span className="rounded bg-neutral-200 px-1 text-[10px] text-neutral-600">無効</span>
                    )}
                  </span>
                  {u.title && <span className="block truncate text-[11px] text-neutral-500">{u.title}</span>}
                </span>
              </span>
              <span className="truncate text-xs text-neutral-500">{u.email ?? "–"}</span>
              <span>
                <select
                  value={roleOf(u)}
                  onChange={(e) => setRoleFor(u.id, e.target.value)}
                  disabled={u.id === currentUserId}
                  className="h-7 w-full rounded border bg-white px-1 text-xs disabled:bg-neutral-100 disabled:text-neutral-400"
                  title={u.id === currentUserId ? "自分自身の権限は変更できません" : undefined}
                >
                  <option value="admin">管理者</option>
                  <option value="member">メンバー</option>
                  <option value="guest">ゲスト</option>
                </select>
              </span>
              <span className="text-neutral-600">{u.open_tasks ?? "–"}</span>
              <span className="flex gap-1 text-xs">
                <button onClick={() => openEdit(u)} className="rounded border px-1.5 py-0.5 hover:bg-neutral-100">
                  編集
                </button>
                <button onClick={() => resetPw(u.id, u.name)} className="rounded border px-1.5 py-0.5 hover:bg-neutral-100">
                  PW
                </button>
                <button
                  onClick={() => toggleActive(u)}
                  disabled={u.id === currentUserId}
                  className="rounded border px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                >
                  {u.deactivated_at ? "有効化" : "無効化"}
                </button>
                <button
                  onClick={() => remove(u.id, u.name)}
                  disabled={u.id === currentUserId}
                  className="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  削除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <h2 className="mt-6 font-semibold">ユーザー作成</h2>
      <div className="mt-2 flex max-w-4xl flex-wrap items-end gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前"
          autoComplete="off"
          className={`${field} w-36`}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メール"
          type="email"
          autoComplete="off"
          className={`${field} w-52`}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="役職（任意）"
          autoComplete="off"
          className={`${field} w-40`}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード（8文字以上）"
          type="password"
          autoComplete="new-password"
          className={`${field} w-44`}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={`${field} h-[34px]`}>
          <option value="member">メンバー</option>
          <option value="guest">ゲスト</option>
          <option value="admin">管理者</option>
        </select>
        <button onClick={create} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
          作成
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-neutral-600">{msg}</p>}

      <h2 className="mt-6 font-semibold">メール招待</h2>
      <div className="mt-2 flex max-w-3xl flex-wrap items-end gap-2">
        <input
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="招待するメールアドレス"
          type="email"
          autoComplete="off"
          className={`${field} w-64`}
        />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className={`${field} h-[34px]`}>
          <option value="member">メンバー</option>
          <option value="guest">ゲスト</option>
          <option value="admin">管理者</option>
        </select>
        <button onClick={invite} className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8]">
          招待
        </button>
      </div>
      {inviteResult && (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs">
          <div className="font-medium text-blue-900">
            {inviteResult.emailed ? "招待メールを送信しました" : "SMTP未設定: 下のリンクを招待者に共有してください"}
          </div>
          <div className="mt-1 flex gap-2">
            <input readOnly value={inviteResult.url} className="min-w-0 flex-1 rounded border bg-white px-2 py-1 font-mono" />
            <button
              onClick={() => navigator.clipboard?.writeText(inviteResult.url).catch(() => undefined)}
              className="rounded border bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50"
            >
              コピー
            </button>
          </div>
          {inviteResult.reason && <div className="mt-1 text-neutral-500">{inviteResult.reason}</div>}
        </div>
      )}
      <div className="mt-3 max-w-3xl">
        {invitations.length === 0 && <p className="text-sm text-neutral-500">保留中の招待はありません。</p>}
        {invitations.map((inv) => (
          <div key={inv.id} className="flex items-center gap-2 border-b py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {inv.email} ・ {inv.role === "admin" ? "管理者" : inv.role === "guest" ? "ゲスト" : "メンバー"} ・ 期限 {inv.expires_at.slice(0, 10)}
            </span>
            <button
              onClick={() => navigator.clipboard?.writeText(inv.url).catch(() => undefined)}
              className="shrink-0 rounded border px-1.5 py-0.5 hover:bg-neutral-100"
            >
              リンク
            </button>
            <button onClick={() => revokeInvite(inv.id)} className="shrink-0 text-neutral-400 hover:text-red-600">
              ×
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">ユーザー編集</h2>
            <div className="mt-3 grid gap-2">
              <label className="text-xs text-neutral-500">
                名前
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
              <label className="text-xs text-neutral-500">
                メール
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
              <label className="text-xs text-neutral-500">
                役職
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
              <label className="text-xs text-neutral-500">
                写真URL
                <input value={editAvatar} onChange={(e) => setEditAvatar(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
              <label className="text-xs text-neutral-500">
                権限
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editing.id === currentUserId}
                  className={`${field} mt-1 w-full`}
                >
                  <option value="admin">管理者</option>
                  <option value="member">メンバー</option>
                  <option value="guest">ゲスト</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                キャンセル
              </button>
              <button onClick={saveEdit} className="rounded bg-[#4075cf] px-4 py-1.5 text-sm text-white hover:bg-[#3567b8]">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
