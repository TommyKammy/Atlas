"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StarButton({
  projectId,
  initial,
}: {
  projectId: number;
  initial: boolean;
}) {
  const router = useRouter();
  const [starred, setStarred] = useState(initial);
  const toggle = async () => {
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setStarred(data.starred === true);
    router.refresh();
  };
  return (
    <button
      onClick={toggle}
      title={starred ? "お気に入りから外す" : "お気に入りに追加"}
      className={`text-lg leading-none ${starred ? "text-amber-400" : "text-neutral-300 hover:text-amber-400"}`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
