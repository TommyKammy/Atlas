"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
  return (
    <button onClick={logout} title="ログアウト" className="shrink-0 text-xs text-neutral-400 hover:text-white">
      退出
    </button>
  );
}
