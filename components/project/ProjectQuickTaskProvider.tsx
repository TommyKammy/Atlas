"use client";

import type { ReactNode } from "react";
import type { Section } from "@/lib/data";
import { QuickTaskProvider } from "@/components/task/QuickTaskContext";

/**
 * The quick-task drafts and the task detail pane are siblings on the project
 * page. Keeping their shared provider above both lets the pane follow an
 * unsaved row without duplicating the draft state.
 */
export default function ProjectQuickTaskProvider({
  projectId,
  sections,
  view,
  canEdit,
  paneTaskId,
  children,
}: {
  projectId: number;
  sections: Section[];
  view: "list" | "board" | "timeline" | "calendar";
  canEdit: boolean;
  paneTaskId: number | null;
  children: ReactNode;
}) {
  return (
    <QuickTaskProvider
      key={projectId}
      projectId={projectId}
      sections={sections}
      view={view}
      canEdit={canEdit}
      paneTaskId={paneTaskId}
    >
      {children}
    </QuickTaskProvider>
  );
}
