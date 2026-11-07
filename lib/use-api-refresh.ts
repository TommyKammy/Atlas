"use client";

import { useRouter } from "next/navigation";

/** Refresh the current server component tree. */
export function useApiRefresh() {
  const router = useRouter();
  return () => router.refresh();
}
