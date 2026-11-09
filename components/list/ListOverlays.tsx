"use client";

import type { CustomField } from "@/lib/custom-fields";
import type { Section, User } from "@/lib/data";
import FieldDialog from "./FieldDialog";
import FieldTypeMenu, { type FieldLibraryEntry } from "./FieldTypeMenu";
import ListSectionMenu, { type SectionMenuState } from "./ListSectionMenu";

export type FieldDialogState =
  | { mode: "create"; type: CustomField["field_type"] }
  | { mode: "edit"; field: CustomField }
  | null;

export type FieldMenuAnchor = {
  left: number;
  right: number;
  top: number;
  bottom: number;
} | null;

/** Menus/dialogs rendered by ListView, kept out of its render body. */
export default function ListOverlays({
  projectId,
  sectionMenu,
  sections,
  fieldMenuAnchor,
  fieldDialog,
  customFields,
  users,
  onCloseSectionMenu,
  onRenameSection,
  onAddSection,
  onToggleCollapseSection,
  onDeleteSection,
  onCloseFieldMenu,
  onFieldRestored,
  onPickFieldTemplate,
  onPickFieldType,
  onCloseFieldDialog,
  onFieldSaved,
}: {
  projectId: number;
  sectionMenu: SectionMenuState | null;
  sections: Section[];
  fieldMenuAnchor: FieldMenuAnchor;
  fieldDialog: FieldDialogState;
  customFields: CustomField[];
  users: User[];
  onCloseSectionMenu: () => void;
  onRenameSection: (section: Section) => void;
  onAddSection: () => void;
  onToggleCollapseSection: (sectionId: number) => void;
  onDeleteSection: (section: Section) => void;
  onCloseFieldMenu: () => void;
  onFieldRestored: () => void;
  onPickFieldTemplate: (entry: FieldLibraryEntry) => void;
  onPickFieldType: (type: CustomField["field_type"]) => void;
  onCloseFieldDialog: () => void;
  onFieldSaved: () => void;
}) {
  return (
    <>
      <ListSectionMenu
        menu={sectionMenu}
        sections={sections}
        onClose={onCloseSectionMenu}
        onRename={onRenameSection}
        onAddSection={onAddSection}
        onToggleCollapse={onToggleCollapseSection}
        onDelete={onDeleteSection}
      />
      {fieldMenuAnchor && (
        <FieldTypeMenu
          projectId={projectId}
          anchor={fieldMenuAnchor}
          onClose={onCloseFieldMenu}
          onRestored={onFieldRestored}
          onPickTemplate={onPickFieldTemplate}
          onPick={onPickFieldType}
        />
      )}
      {fieldDialog && (
        <FieldDialog
          projectId={projectId}
          mode={fieldDialog.mode}
          initialType={fieldDialog.mode === "create" ? fieldDialog.type : fieldDialog.field.field_type}
          field={fieldDialog.mode === "edit" ? fieldDialog.field : null}
          availableFields={customFields}
          users={users}
          onClose={onCloseFieldDialog}
          onSaved={onFieldSaved}
        />
      )}
    </>
  );
}
