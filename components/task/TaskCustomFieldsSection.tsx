"use client";

import type { ReactNode } from "react";
import type { CustomField } from "@/lib/custom-fields";
import TaskFieldRow from "./TaskFieldRow";

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
    <div className="mt-3 flex flex-col gap-3" data-task-custom-fields>
      {customFields.map((field) => (
        <TaskFieldRow key={field.id} label={field.name}>
          {renderEditor(field)}
        </TaskFieldRow>
      ))}
    </div>
  );
}
