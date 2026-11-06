import { getUsers } from "@/lib/data";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/ProfileForm";

export const instant = false;

export default async function ProfilePage() {
  const uid = await getCurrentUserId();
  if (!uid) redirect("/login");
  const users = await getUsers();
  const me = users.find((u) => u.id === uid) ?? null;
  if (!me) {
    return (
      <div className="p-8">
        <p className="text-sm text-neutral-500">ユーザーがありません。</p>
      </div>
    );
  }
  return (
    <div className="max-w-xl p-6">
      <h1 className="text-lg font-bold">プロフィール</h1>
      <ProfileForm
        userId={me.id}
        initialName={me.name}
        initialEmail={me.email ?? ""}
        initialTitle={me.title ?? ""}
        initialAvatarUrl={me.avatar_url ?? ""}
        isGuest={me.is_guest}
      />
    </div>
  );
}
