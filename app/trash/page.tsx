import Link from "next/link";
import { getArchivedProjects, getTrash, getWorkspace } from "@/lib/data";
import TrashList from "@/components/TrashList";
import ArchivedProjects from "@/components/ArchivedProjects";

export const instant = false;

export default async function TrashPage() {
  const ws = await getWorkspace();
  const items = ws ? await getTrash(ws.id) : [];
  const archived = ws ? await getArchivedProjects(ws.id) : [];
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">削除済み</h1>
      <p className="mt-1 text-sm text-neutral-500">
        ゴミ箱内のタスク（{items.length}件）。復元または完全削除ができます。
        削除から30日後に自動で完全削除されます。
      </p>
      <TrashList initial={items} />
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
