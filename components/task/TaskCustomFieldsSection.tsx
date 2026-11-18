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
    <div className="space-y-0.5" data-task-custom-fields>
      {customFields.map((field) => (
        <div key={field.id} className="flex min-h-9 items-center gap-2 rounded-md px-1 py-1 hover:bg-hover">
          <span className="w-[88px] shrink-0 truncate text-[12px] text-muted" title={field.name}>
            {field.name}
          </span>
          <span className="min-w-0 flex-1">{renderEditor(field)}</span>
        </div>
      ))}
    </div>
  );
}
