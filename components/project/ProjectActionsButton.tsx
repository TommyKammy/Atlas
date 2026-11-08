"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import type { ProjectRole } from "@/lib/project-roles";
import type { CustomField } from "@/lib/custom-fields";
import type { ProjectActionKey } from "@/lib/project-actions";
import ProjectActionsMenu from "./ProjectActionsMenu";
import ProjectSettingsDialog from "./ProjectSettingsDialog";
import ProjectPermissionsDialog from "./ProjectPermissionsDialog";
import ProjectAppearanceDialog from "./ProjectAppearanceDialog";
import DuplicateProjectDialog from "./DuplicateProjectDialog";
import SaveProjectTemplateDialog from "./SaveProjectTemplateDialog";
import AddToPortfolioDialog from "./AddToPortfolioDialog";
import ProjectImportDialog from "./ProjectImportDialog";
import CreateTableDialog from "./CreateTableDialog";
import DeleteProjectDialog from "./DeleteProjectDialog";
import ArchiveProjectDialog from "./ArchiveProjectDialog";

type ActionProject = {
  id: number;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
};

type DialogKey =
  | "settings"
  | "permissions"
  | "appearance"
  | "duplicate"
  | "template"
  | "portfolio"
  | "table"
  | "import"
  | "archive"
  | "delete";

/** Header project title arrow. Owns the Asana-like action menu and dialogs. */
export default function ProjectActionsButton({
  project,
  role,
  customFields,
}: {
  project: ActionProject;
  role: ProjectRole;
  customFields: CustomField[];
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [importMode, setImportMode] = useState<"file" | "csv">("csv");
  const [color, setColor] = useState(project.color ?? null);
  const [icon, setIcon] = useState(project.icon ?? null);
  const [archiving, setArchiving] = useState(false);
  const [busyAction, setBusyAction] = useState<ProjectActionKey | null>(null);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 264;
    const estimatedHeight = 480;
    setMenuPos({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - estimatedHeight - 8)),
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/projects/${project.id}?view=list`);
      toast("プロジェクトのリンクをコピーしました");
    } catch {
      toast("リンクをコピーできませんでした");
    }
  };

  const createPublicLink = async () => {
    if (role !== "admin") {
      toast("公開リンクの作成はプロジェクト管理者のみ可能です");
      return;
    }
    setBusyAction("public-link");
    try {
      const result = await api<{ token: string }>(`/api/projects/${project.id}/share`, "POST", {
        label: "公開リンク",
        expires_in_days: null,
      });
      const url = `${location.origin}/share/${result.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast("公開リンクを作成し、コピーしました");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "公開リンクを作成できませんでした");
    } finally {
      setBusyAction(null);
    }
  };

  const exportProject = (format: string) => {
    const anchor = document.createElement("a");
    anchor.href = `/api/projects/${project.id}/export?format=${encodeURIComponent(format)}`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const onSelect = (action: ProjectActionKey) => {
    if (action === "copy-link") {
      void copyLink();
      return;
    }
    if (action === "public-link") {
      void createPublicLink();
      return;
    }
    if (action === "export-csv") return exportProject("csv");
    if (action === "export-xlsx") return exportProject("xlsx");
    if (action === "export-json") return exportProject("json");
    if (action === "export-timecsv") return exportProject("timecsv");
    if (action === "export-ical") return exportProject("ical");
    if (action === "export-print") {
      window.open(`/projects/${project.id}/print`, "_blank", "noopener,noreferrer");
      return;
    }
    if (action === "import-file" || action === "import-csv") {
      setImportMode(action === "import-file" ? "file" : "csv");
      setDialog("import");
      return;
    }
    setDialog(action as DialogKey);
  };

  const saveAppearance = async (patch: { color?: string | null; icon?: string | null }) => {
    setBusyAction("appearance");
    try {
      await api(`/api/projects/${project.id}`, "PATCH", patch);
      if ("color" in patch) setColor(patch.color ?? null);
      if ("icon" in patch) setIcon(patch.icon ?? null);
      router.refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "外観の更新に失敗しました");
    } finally {
      setBusyAction(null);
    }
  };

  const archive = async () => {
    setArchiving(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", { archived: true });
      setDialog(null);
      toast("プロジェクトをアーカイブしました");
      router.refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "アーカイブに失敗しました");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-project-actions-button
        aria-label="プロジェクトのアクション"
        aria-haspopup="menu"
        aria-expanded={menuPos !== null}
        title="プロジェクトのアクション"
        onClick={() => (menuPos ? setMenuPos(null) : openMenu())}
        className={`-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c60b8] ${
          menuPos ? "bg-neutral-100 text-neutral-700" : ""
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {menuPos && (
        <ProjectActionsMenu
          pos={menuPos}
          role={role}
          onClose={() => setMenuPos(null)}
          onSelect={onSelect}
        />
      )}

      {dialog === "settings" && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {dialog === "permissions" && (
        <ProjectPermissionsDialog
          projectId={project.id}
          projectName={project.name}
          customFields={customFields}
          onClose={() => setDialog(null)}
          onOpenFields={() => {
            setDialog(null);
            window.dispatchEvent(new CustomEvent("atlas:open-customize", { detail: { panel: "fields" } }));
          }}
        />
      )}
      {dialog === "appearance" && (
        <ProjectAppearanceDialog
          projectId={project.id}
          projectName={project.name}
          color={color}
          icon={icon}
          onSave={(patch) => void saveAppearance(patch)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
      {dialog === "duplicate" && (
        <DuplicateProjectDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onDuplicated={(id) => {
            setDialog(null);
            router.push(`/projects/${id}?view=list`);
            router.refresh();
          }}
        />
      )}
      {dialog === "template" && (
        <SaveProjectTemplateDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {dialog === "portfolio" && (
        <AddToPortfolioDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onChanged={() => router.refresh()}
        />
      )}
      {dialog === "table" && (
        <CreateTableDialog
          projectId={project.id}
          projectName={project.name}
          isAdmin={role === "admin"}
          onClose={() => setDialog(null)}
          onCreated={() => router.refresh()}
        />
      )}
      {dialog === "import" && (
        <ProjectImportDialog
          projectId={project.id}
          projectName={project.name}
          initialMode={importMode}
          onClose={() => setDialog(null)}
          onImported={() => router.refresh()}
        />
      )}
      {dialog === "archive" && (
        <ArchiveProjectDialog
          projectName={project.name}
          busy={archiving}
          onClose={() => setDialog(null)}
          onArchive={() => void archive()}
        />
      )}
      {dialog === "delete" && (
        <DeleteProjectDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            router.push("/");
            router.refresh();
          }}
        />
      )}
      {busyAction === "public-link" && (
        <span className="sr-only" role="status">
          公開リンクを作成中
        </span>
      )}
    </>
  );
}
