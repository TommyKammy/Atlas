import { hasPermission } from "@/lib/permissions";
import { getCurrentUserId } from "@/lib/current-user";
import CreateMenu from "./CreateMenu";
import SearchBox from "./SearchBox";

export default async function HeaderAuth() {
  const uid = await getCurrentUserId();
  if (uid === null) {
    return <span className="text-sm font-semibold text-white">Atlas</span>;
  }
  return (
    <>
      <CreateMenu canCreateProject={await hasPermission(uid, "projects.create")} />
      <SearchBox />
    </>
  );
}
