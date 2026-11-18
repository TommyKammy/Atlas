import { requirePageUser } from "@/lib/current-user";
import Link from "next/link";
import { getArchivedProjects, getDeletedProjects, getTrash, getWorkspace } from "@/lib/data";
import TrashList from "@/components/TrashList";
import ArchivedProjects from "@/components/ArchivedProjects";
import DeletedProjects from "@/components/DeletedProjects";

export const instant = false;

export default async function TrashPage() {
  const user = await requirePageUser();
  const ws = await getWorkspace();
  const items = ws ? await getTrash(ws.id, user.id) : [];
  const archived = ws ? await getArchivedProjects(ws.id, user.id) : [];
  const deleted = ws ? await getDeletedProjects(ws.id, user.id) : [];
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">削除済み</h1>
      <p className="mt-1 text-sm text-muted">
        ゴミ箱内のタスク（{items.length}件）。復元または完全削除ができます。
        削除から30日後に自動で完全削除されます。
      </p>
      <TrashList initial={items} />
      <h2 className="mt-8 text-sm font-semibold">削除済みプロジェクト（{deleted.length}件）</h2>
      <DeletedProjects initial={deleted} />
      <h2 className="mt-8 text-sm font-semibold">アーカイブ済みプロジェクト（{archived.length}件）</h2>
      <ArchivedProjects initial={archived} />
      <p className="mt-6 text-sm">
        <Link href="/" className="text-blue-700 hover:underline">
          ← ホームに戻る
        </Link>
      </p>
    </div>
  );
}
