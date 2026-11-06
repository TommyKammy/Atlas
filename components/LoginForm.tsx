"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("メールアドレスまたはパスワードが違います");
    }
  };

  const field = "w-full rounded border px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <form onSubmit={submit} className="flex w-80 flex-col gap-3 rounded-lg border bg-white p-6 shadow">
      <h1 className="text-lg font-bold">Atlas にログイン</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="メールアドレス"
        autoComplete="email"
        className={field}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        autoComplete="current-password"
        className={field}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="rounded bg-blue-600 py-2 text-sm text-white hover:bg-blue-700">
        ログイン
      </button>
      <p className="text-xs text-neutral-400">開発用初期値：admin@example.com / atlas-dev-2026</p>
    </form>
  );
}
