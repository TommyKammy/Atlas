"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Registered per view. `null` means the current view has nowhere to show a
 * section draft, so the toolbar option is hidden instead of opening a form.
 */
const SectionDraftContext = createContext<(() => void) | null>(null);

export function SectionDraftProvider({
  start,
  children,
}: {
  start: (() => void) | null;
  children: ReactNode;
}) {
  return <SectionDraftContext.Provider value={start}>{children}</SectionDraftContext.Provider>;
}

export function useSectionDraftStart() {
  return useContext(SectionDraftContext);
}
