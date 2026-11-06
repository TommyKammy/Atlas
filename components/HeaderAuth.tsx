import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import CreateMenu from "./CreateMenu";
import SearchBox from "./SearchBox";

export default async function HeaderAuth() {
  const uid = await getCurrentUserId();
  const authed =
    uid !== null &&
    (await db.query("SELECT id FROM users WHERE id = $1", [uid]).catch(() => null))?.rowCount !== 0;
  if (!authed) {
    return <span className="text-sm font-semibold text-white">Atlas</span>;
  }
  return (
    <>
      <CreateMenu />
      <SearchBox />
    </>
  );
}
