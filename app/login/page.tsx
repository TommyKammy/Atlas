import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import LoginForm from "@/components/LoginForm";
import { getSecuritySettings } from "@/lib/admin-data";

export const instant = false;

export default async function LoginPage() {
  const uid = await getCurrentUserId();
  const r = await db.query("SELECT id FROM users WHERE id = $1", [uid]);
  if (r.rowCount !== 0) {
    return (
      <div className="p-8">
        <p className="text-sm">ログイン済みです。</p>
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ホームへ →
        </Link>
      </div>
    );
  }
  const security = await getSecuritySettings();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoginForm samlMode={security.saml_mode} />
    </div>
  );
}
