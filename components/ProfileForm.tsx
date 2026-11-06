"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import UserAvatar from "./UserAvatar";

export default function ProfileForm({
  userId,
  initialName,
  initialEmail,
  initialTitle,
  initialAvatarUrl,
  isGuest,
}: {
  userId: number;
  initialName: string;
  initialEmail: string;
  initialTitle: string;
  initialAvatarUrl: string;
  isGuest: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [title, setTitle] = useState(initialTitle);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState("");

  const saveProfile = async () => {
    setMsg("");
    if (!name.trim()) {
      setMsg("名前を入力してください");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMsg("有効なメールアドレスを入力してください");
      return;
    }
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, title, avatar_url: avatarUrl }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setMsg("プロフィールを更新しました");
      if (typeof data?.avatar_url === "string") setAvatarUrl(data.avatar_url);
      router.refresh();
    } else {
      setMsg(`更新に失敗しました: ${data?.error ?? res.status}`);
    }
  };

  const savePassword = async () => {
    setMsg("");
    if (newPw.length < 8) {
      setMsg("新しいパスワードは8文字以上にしてください");
      return;
    }
    if (newPw !== confirmPw) {
      setMsg("確認用と一致しません");
      return;
    }
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setMsg("パスワードを更新しました");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } else {
      setMsg(`更新に失敗しました: ${data?.error ?? res.status}`);
    }
  };

  const field = "w-full rounded border px-2 py-1.5 text-sm outline-none focus:border-blue-500";
  return (
    <div className="mt-4 space-y-6">
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">プロフィール{isGuest ? "（ゲスト）" : ""}</h2>
        <div className="mt-3 flex items-center gap-3">
          <UserAvatar name={name} url={avatarUrl} className="h-14 w-14" textClassName="text-lg" />
          <div className="min-w-0 flex-1">
            <label className="text-xs text-neutral-500">写真URL（任意）</label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className={field}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-neutral-500">
            表示名
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="text-xs text-neutral-500">
            役職・肩書き
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: プロジェクトマネージャー"
              className={field}
            />
          </label>
          <label className="text-xs text-neutral-500 sm:col-span-2">
            メールアドレス
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
        </div>
        <button
          onClick={saveProfile}
          className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          プロフィールを保存
        </button>
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">パスワード変更</h2>
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="現在のパスワード"
            autoComplete="current-password"
            className={field}
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="新しいパスワード（8文字以上）"
            autoComplete="new-password"
            className={field}
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="新しいパスワード（確認）"
            autoComplete="new-password"
            className={field}
          />
          <button
            onClick={savePassword}
            className="self-start rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            変更
          </button>
        </div>
      </section>
      {msg && <p className="text-sm text-neutral-600">{msg}</p>}
      <p className="text-xs text-neutral-400">ユーザーID: {userId}</p>
    </div>
  );
}
