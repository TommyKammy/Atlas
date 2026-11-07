"use client";

import type { ReactNode } from "react";
import type { CustomField } from "@/lib/custom-fields";

/** Custom field rows in the task pane; editor rendering stays with the parent. */
export default function TaskCustomFieldsSection({
  customFields,
  renderEditor,
}: {
  customFields: CustomField[];
  renderEditor: (field: CustomField) => ReactNode;
}) {
  if (customFields.length === 0) return null;
  return (
    <div className="mt-2 space-y-0.5">
      {customFields.map((f) => (
        <div key={f.id} className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
          <span className="w-28 shrink-0 truncate text-sm text-neutral-500">{f.name}</span>
          <span className="min-w-0 flex-1">{renderEditor(f)}</span>
        </div>
      ))}
    </div>
  );
}
