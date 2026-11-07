"use client";

import { api } from "@/lib/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ProjectIcon from "./ProjectIcon";
import NavPending from "./NavPending";
import { useMutation } from "@/lib/use-mutation";
import { toast } from "@/lib/ui-feedback";
import ProjectContextMenu from "./project/ProjectContextMenu";
import ProjectShareDialog from "./project/ProjectShareDialog";
import RenameProjectDialog from "./project/RenameProjectDialog";
import ProjectAppearanceDialog from "./project/ProjectAppearanceDialog";
import ArchiveProjectDialog from "./project/ArchiveProjectDialog";

type CtxProject = {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
};

export default function SidebarProjectLink({
  project,
  href,
  className,
  starred = false,
  leading = "project",
}: {
  project: CtxProject;
  href: string;
  className: string;
  starred?: boolean;
  leading?: "project" | "star";
}) {
  const router = useRouter();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<null | "share" | "rename" | "appearance" | "archive">(null);
  const [starredState, setStarredState] = useState(starred);
  const [color, setColor] = useState(project.color ?? null);
  const [icon, setIcon] = useState(project.icon ?? null);
  const [renameVal, setRenameVal] = useState(project.name);
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setStarredState(starred), [starred]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setColor(project.color ?? null), [project.color]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setIcon(project.icon ?? null), [project.icon]);

  const favoriteMutation = useMutation(async () => {
    const data = await api<{ starred: boolean }>("/api/favorites", "POST", { project_id: project.id });
    setStarredState(data.starred === true);
    toast(data.starred ? "お気に入りに追加しました" : "お気に入りから削除しました");
    router.refresh();
    return data;
  });

  useEffect(() => {
    if (!pos && !dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPos(null);
        setDialog(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pos, dialog]);

  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const w = 225;
    const h = 302;
    setPos({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(event.clientY - 6, window.innerHeight - h - 8)),
    });
    setRenameVal(project.name);
  };

  const copyLink = async () => {
    setPos(null);
    try {
      await navigator.clipboard.writeText(`${location.origin}/projects/${project.id}?view=list`);
      toast("リンクをコピーしました");
    } catch {
      toast("リンクをコピーできませんでした");
    }
  };

  const toggleFavorite = async () => {
    setPos(null);
    setBusy(true);
    const result = await favoriteMutation.run();
    if (!result) toast("更新に失敗しました");
    setBusy(false);
  };

  const addPortfolio = async () => {
    setPos(null);
    setBusy(true);
    try {
      await api("/api/portfolio", "POST", { project_id: project.id });
      toast("マイポートフォリオに追加しました");
      router.refresh();
    } catch {
      toast("追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    const name = renameVal.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", { name });
      setDialog(null);
      toast("プロジェクト名を変更しました");
      router.refresh();
    } catch {
      toast("名前の変更に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const saveAppearance = async (patch: { color?: string | null; icon?: string | null }) => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", patch);
      if ("color" in patch) setColor(patch.color ?? null);
      if ("icon" in patch) setIcon(patch.icon ?? null);
      router.refresh();
    } catch {
      toast("外観の更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, "PATCH", { archived: true });
      setDialog(null);
      toast("プロジェクトをアーカイブしました");
      router.refresh();
    } catch {
      toast("アーカイブに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href={href} className={className} onContextMenu={openMenu}>
        {leading === "star" ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-300">
            <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
          </svg>
        ) : (
          <ProjectIcon
            id={project.id}
            name={project.name}
            color={color}
            icon={icon}
            className="h-4 w-4 text-[9px]"
          />
        )}
        <span className="truncate">{project.name}</span>
        <NavPending className="ml-auto" />
      </Link>

      {pos && (
        <ProjectContextMenu
          pos={pos}
          project={project}
          starred={starredState}
          busy={busy}
          onClose={() => setPos(null)}
          onShare={() => {
            setPos(null);
            setDialog("share");
          }}
          onOpenNewTab={() => {
            setPos(null);
            window.open(href, "_blank", "noopener");
          }}
          onCopyLink={() => void copyLink()}
          onAppearance={() => {
            setPos(null);
            setDialog("appearance");
          }}
          onRename={() => {
            setPos(null);
            setRenameVal(project.name);
            setDialog("rename");
          }}
          onToggleFavorite={() => void toggleFavorite()}
          onAddPortfolio={() => void addPortfolio()}
          onArchive={() => {
            setPos(null);
            setDialog("archive");
          }}
        />
      )}

      {dialog === "share" && (
        <ProjectShareDialog projectId={project.id} projectName={project.name} onClose={() => setDialog(null)} />
      )}
      {dialog === "rename" && (
        <RenameProjectDialog
          value={renameVal}
          busy={busy}
          onChange={setRenameVal}
          onClose={() => setDialog(null)}
          onSave={() => void saveRename()}
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
      {dialog === "archive" && (
        <ArchiveProjectDialog
          projectName={project.name}
          busy={busy}
          onClose={() => setDialog(null)}
          onArchive={() => void archive()}
        />
      )}
    </>
  );
}
