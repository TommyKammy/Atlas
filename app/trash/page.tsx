import { requirePageUser } from "@/lib/current-user";
import Link from "next/link";
import { getArchivedProjects, getDeletedProjects, getTrash, getWorkspace } from "@/lib/data";
import TrashList from "@/components/TrashList";
import ArchivedProjects from "@/components/ArchivedProjects";
import DeletedProjects from "@/components/DeletedProjects";
import { quietButtonClass } from "@/components/ui/form-controls";
import { pageDescriptionClass, pageShellClass, pageTitleClass } from "@/components/ui/page-layout";

export const instant = false;

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-[13px] font-semibold text-text">
      {label}
      <span className="text-[12px] font-normal tabular-nums text-muted">{count}件</span>
    </h2>
  );
}

export default async function TrashPage() {
  const user = await requirePageUser();
  const ws = await getWorkspace();
  const items = ws ? await getTrash(ws.id, user.id) : [];
  const archived = ws ? await getArchivedProjects(ws.id, user.id) : [];
  const deleted = ws ? await getDeletedProjects(ws.id, user.id) : [];
  return (
    <div className={pageShellClass}>
      <div className="max-w-5xl">
        <h1 className={pageTitleClass}>削除済み</h1>
        <p className={pageDescriptionClass}>削除したタスクとプロジェクトを復元できます。完全に削除したものは元に戻せません。</p>

        <section className="mt-6">
          <SectionHeading label="ゴミ箱のタスク" count={items.length} />
          <p className="mt-0.5 text-[12px] text-muted">復元または完全削除ができます。削除から30日後に自動で完全削除されます。</p>
          <TrashList initial={items} />
        </section>

        <section className="mt-8">
          <SectionHeading label="削除済みプロジェクト" count={deleted.length} />
          <p className="mt-0.5 text-[12px] text-muted">削除したプロジェクトは復元するか、完全に削除できます。</p>
          <DeletedProjects initial={deleted} />
        </section>

        <section className="mt-8">
          <SectionHeading label="アーカイブ済みプロジェクト" count={archived.length} />
          <p className="mt-0.5 text-[12px] text-muted">アーカイブしたプロジェクトは通常の一覧から隠れます。復元すると一覧に戻ります。</p>
          <ArchivedProjects initial={archived} />
        </section>

        <p className="mt-8">
          <Link href="/" className={quietButtonClass}>
            ← ホームに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
