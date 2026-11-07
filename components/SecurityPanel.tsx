"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/lib/ui-feedback";
import { api } from "@/lib/api-client";
import {
  PERMISSION_CATALOG,
  type Permission,
} from "@/lib/permission-catalog";
import type { AdminRole, SecuritySettings, TotpUserRow } from "@/lib/admin-data";
import UserAvatar from "./UserAvatar";

type SectionKey = "rbac" | "two-factor" | "saml" | "password";

const SECTION_LABEL: Record<SectionKey, string> = {
  rbac: "役割とアクセス",
  "two-factor": "二要素認証",
  saml: "SAML 認証",
  password: "パスワード強度",
};

const BASE_LABEL: Record<AdminRole["base_level"], string> = {
  admin: "管理者",
  member: "メンバー",
  guest: "ゲスト",
};

const BASE_LEVEL_HINT: Record<AdminRole["base_level"], string> = {
  admin: "管理コンソールへのアクセスを含む役割です",
  member: "通常のワークスペースメンバーです",
  guest: "外部コラボレーター向けの限定アクセスです",
};

const MEMBER_ONLY: Permission[] = ["projects.create", "tasks.create"];

const field =
  "mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
    </div>
  );
}

function RbacSection({ initialRoles }: { initialRoles: AdminRole[] }) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseLevel, setBaseLevel] = useState<AdminRole["base_level"]>("member");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setBaseLevel("member");
    setPermissions(["projects.create", "tasks.create"]);
    setMsg("");
    setOpen(true);
  };

  const openEdit = (role: AdminRole) => {
    setEditing(role);
    setName(role.name);
    setDescription(role.description);
    setBaseLevel(role.base_level);
    setPermissions(role.permissions);
    setMsg("");
    setOpen(true);
  };

  const togglePermission = (permission: Permission) => {
    setPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const payload = { name, description, base_level: baseLevel, permissions };
    try {
      const data = editing
        ? await api<{ roles: AdminRole[] }>(`/api/admin/roles/${editing.id}`, "PATCH", payload)
        : await api<{ roles: AdminRole[] }>("/api/admin/roles", "POST", payload);
      setRoles(data.roles);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role: AdminRole) => {
    if (!(await confirmAction(`役割「${role.name}」を削除しますか？`))) return;
    try {
      const data = await api<{ roles: AdminRole[] }>(`/api/admin/roles/${role.id}`, "DELETE");
      setRoles(data.roles);
      router.refresh();
    } catch (e) {
      setMsg(`削除に失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };

  const allowedPermissions = baseLevel === "admin"
    ? PERMISSION_CATALOG.map((entry) => entry.key)
    : MEMBER_ONLY;

  return (
    <div data-security-section="rbac">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="ロールベースのアクセス制御 (RBAC)"
          description="役割を管理し、権限を設定することで、ユーザーが Atlas で行えることを制御できます。"
        />
        <button
          onClick={openCreate}
          data-role-create
          className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8]"
        >
          役割を作成
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(220px,1.4fr)_120px_130px_120px_120px] gap-3 border-b bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-500">
            <span>名前</span>
            <span>メンバー</span>
            <span>タイプ</span>
            <span>権限</span>
            <span>操作</span>
          </div>
          {roles.map((role) => (
            <div
              key={role.id}
              data-role={role.key}
              className="grid grid-cols-[minmax(220px,1.4fr)_120px_130px_120px_120px] items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{role.name}</span>
                  {role.is_super && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">特権</span>
                  )}
                  {role.is_system && !role.is_super && (
                    <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-500">標準</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-neutral-500">{role.description}</span>
              </span>
              <span className="text-xs text-neutral-600">{role.member_count} 人</span>
              <span className="text-xs text-neutral-600">
                {role.is_system ? "標準" : "カスタム"} / {BASE_LABEL[role.base_level]}
              </span>
              <span className="text-xs text-neutral-600">{role.permissions.length} 件</span>
              <span className="flex gap-1 text-xs">
                {!role.is_system && (
                  <>
                    <button
                      onClick={() => openEdit(role)}
                      className="rounded border px-1.5 py-0.5 hover:bg-neutral-100"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => remove(role)}
                      className="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50"
                    >
                      削除
                    </button>
                  </>
                )}
                {role.is_system && <span className="text-[11px] text-neutral-400">変更不可</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
        <strong className="font-semibold text-neutral-700">標準の役割</strong> は変更できません。カスタム役割では
        管理コンソールの権限とワークスペースの操作権限を個別に付与できます。
      </div>

      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="役割を作成"
            data-role-dialog
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold">{editing ? "役割を編集" : "カスタム役割を作成"}</h3>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className="rounded p-1 text-neutral-500 hover:bg-neutral-100">
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-neutral-600">
                役割名
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} data-role-name-input />
              </label>
              <label className="text-xs text-neutral-600">
                説明
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className={`${field} resize-y`}
                />
              </label>
              <label className="text-xs text-neutral-600">
                基本の役割
                <select
                  value={baseLevel}
                  onChange={(e) => {
                    const next = e.target.value as AdminRole["base_level"];
                    setBaseLevel(next);
                    setPermissions((prev) => prev.filter((p) => next === "admin" || MEMBER_ONLY.includes(p)));
                  }}
                  className={field}
                >
                  <option value="member">メンバー</option>
                  <option value="guest">ゲスト</option>
                  <option value="admin">管理者</option>
                </select>
                <span className="mt-1 block text-[11px] text-neutral-400">{BASE_LEVEL_HINT[baseLevel]}</span>
              </label>
              <div>
                <div className="text-xs text-neutral-600">権限</div>
                <div className="mt-1 grid gap-1 rounded border p-2 sm:grid-cols-2">
                  {PERMISSION_CATALOG.map((permission) => {
                    const disabled = !allowedPermissions.includes(permission.key);
                    return (
                      <label
                        key={permission.key}
                        className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${
                          disabled ? "opacity-40" : "hover:bg-neutral-50"
                        }`}
                        title={permission.description}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={permissions.includes(permission.key)}
                          disabled={disabled}
                          onChange={() => togglePermission(permission.key)}
                        />
                        <span>
                          <span className="font-medium">{permission.label}</span>
                          <span className="block text-[10px] text-neutral-400">{permission.group}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-neutral-400">
                  管理コンソールの権限は「管理者」を基本の役割にした場合のみ付与できます。
                </p>
              </div>
            </div>
            {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="rounded bg-[#4075cf] px-4 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
              >
                {saving ? "保存中…" : editing ? "変更を保存" : "役割を作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TwoFactorSection({
  settings,
  totpUsers,
  onSettings,
  currentUserId,
}: {
  settings: SecuritySettings;
  totpUsers: TotpUserRow[];
  onSettings: (settings: SecuritySettings, users?: TotpUserRow[]) => void;
  currentUserId: number;
}) {
  const [policy, setPolicy] = useState(settings.two_factor_policy);
  const [users, setUsers] = useState(totpUsers);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings; totpUsers: TotpUserRow[] }>(
        "/api/admin/security",
        "PATCH",
        { two_factor_policy: policy },
      );
      onSettings(data.settings, data.totpUsers);
      setMsg("二要素認証の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const resetUser = async (user: TotpUserRow) => {
    if (!(await confirmAction(`${user.name} の二要素認証をリセットしますか？`))) return;
    try {
      await api(`/api/admin/users/${user.id}/2fa`, "DELETE");
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, totp_enabled: false, totp_enrolled_at: null } : u)));
    } catch (e) {
      setMsg(`リセットに失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div data-security-section="two-factor">
      <SectionHeader
        title="二要素認証"
        description="メンバーとゲストに 2 つ目の認証方法を使用してサインインすることを義務づけます。"
      />
      <div className="mt-4 max-w-2xl rounded-lg border border-neutral-200 p-4">
        <div className="text-xs font-medium text-neutral-600">二要素認証のポリシー</div>
        <div className="mt-2 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="two-factor-policy"
              checked={policy === "optional"}
              onChange={() => setPolicy("optional")}
              data-two-factor-policy-optional
            />
            <span>
              任意
              <span className="block text-[11px] text-neutral-400">
                ユーザーが自分のプロフィールから二要素認証を有効化できます。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="two-factor-policy"
              checked={policy === "required"}
              onChange={() => setPolicy("required")}
              data-two-factor-policy-required
            />
            <span>
              すべてのメンバーとゲストに対して必須
              <span className="block text-[11px] text-neutral-400">
                次回サインイン時に、プロフィールから二要素認証の設定を促します。
              </span>
            </span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-two-factor-save
            className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-neutral-600">{msg}</span>}
        </div>
      </div>

      <div className="mt-4 max-w-2xl rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">メンバーの二要素認証</h4>
          <a href="/profile#two-factor" className="text-xs text-blue-700 hover:underline">
            自分の設定を開く →
          </a>
        </div>
        <div className="mt-2 divide-y">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-2 py-2 text-sm" data-totp-user={user.id}>
              <UserAvatar name={user.name} url={null} className="h-6 w-6" textClassName="text-[9px]" />
              <span className="min-w-0 flex-1 truncate">
                {user.name}
                {user.id === currentUserId && <span className="ml-1 text-[10px] text-neutral-400">(自分)</span>}
              </span>
              <span className="w-24 text-[11px] text-neutral-500">{user.role_name ?? "–"}</span>
              <span
                className={`w-20 rounded px-1.5 py-0.5 text-center text-[11px] ${
                  user.totp_enabled ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {user.totp_enabled ? "有効" : "未設定"}
              </span>
              <button
                onClick={() => resetUser(user)}
                disabled={!user.totp_enabled}
                className="rounded border px-1.5 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
              >
                リセット
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SamlSection({
  settings,
  onSettings,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
}) {
  const [mode, setMode] = useState(settings.saml_mode);
  const [signinUrl, setSigninUrl] = useState(settings.saml_signin_url);
  const [certificate, setCertificate] = useState(settings.saml_certificate);
  const [sessionDays, setSessionDays] = useState(String(settings.saml_session_days));
  const [jit, setJit] = useState(settings.saml_jit_provisioning);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings }>("/api/admin/security", "PATCH", {
        saml_mode: mode,
        saml_signin_url: signinUrl,
        saml_certificate: certificate,
        saml_session_days: Number(sessionDays),
        saml_jit_provisioning: jit,
      });
      onSettings(data.settings);
      setMsg("SAML の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const acsUrl = `${origin}/api/auth/saml/callback`;
  const metadataUrl = `${origin}/api/auth/saml/metadata`;
  const issuer = `atlas-sp-${settings.workspace_id}`;

  const copy = (value: string) => navigator.clipboard?.writeText(value).catch(() => undefined);

  return (
    <div data-security-section="saml">
      <SectionHeader
        title="SAML 認証"
        description="Azure、Okta、OneLogin または SAML のカスタムソリューションでセットアップします。"
      />

      <div className="mt-4 max-w-3xl rounded-lg border border-neutral-200 p-4">
        <div className="text-xs font-medium text-neutral-600">SAML のモード</div>
        <div className="mt-2 space-y-2 text-sm">
          {(
            [
              ["off", "オフ"],
              ["optional", "任意"],
              ["required", "必須（すべてのメンバーとゲスト）"],
              ["members_only", "必須（ゲストアカウントを除くすべてのメンバー）"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="saml-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
                data-saml-mode={value}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">
          必須にすると、対象ユーザーはパスワードではなく SAML SSO でサインインします。管理者は緊急時のためにパスワードでサインインできます。
        </p>

        <div className="mt-4 grid gap-3">
          <label className="text-xs text-neutral-600">
            サインインページの URL
            <input
              value={signinUrl}
              onChange={(e) => setSigninUrl(e.target.value)}
              placeholder="https://company-app.okta.com/app/company/..."
              className={field}
              data-saml-signin-url
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              このフィールドは IdP から提供されます。「ログイン URL」というラベルが付いている場合があります。
            </span>
          </label>
          <label className="text-xs text-neutral-600">
            X.509 証明書
            <textarea
              value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="ここに X.509 証明書をコピーして貼り付け…"
              rows={6}
              className={`${field} resize-y font-mono text-[11px]`}
              data-saml-certificate
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-neutral-600">
              セッションタイムアウト
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={sessionDays}
                  onChange={(e) => setSessionDays(e.target.value)}
                  className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                  data-saml-session-days
                />
                <span className="text-sm text-neutral-500">日</span>
              </div>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={jit} onChange={(e) => setJit(e.target.checked)} />
              初回サインイン時にユーザーを自動作成する
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-saml-save
            className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-neutral-600">{msg}</span>}
        </div>
      </div>

      <div className="mt-4 max-w-3xl rounded-lg border border-neutral-200 p-4">
        <h4 className="text-sm font-semibold">IdP に登録するサービスプロバイダー情報</h4>
        <div className="mt-2 space-y-2 text-xs">
          <div>
            <div className="text-neutral-500">ACS URL</div>
            <div className="mt-0.5 flex gap-2">
              <input readOnly value={acsUrl} className="min-w-0 flex-1 rounded border bg-neutral-50 px-2 py-1 font-mono" />
              <button onClick={() => copy(acsUrl)} className="rounded border px-2 py-1 hover:bg-neutral-100">
                コピー
              </button>
            </div>
          </div>
          <div>
            <div className="text-neutral-500">SP メタデータ URL</div>
            <div className="mt-0.5 flex gap-2">
              <input readOnly value={metadataUrl} className="min-w-0 flex-1 rounded border bg-neutral-50 px-2 py-1 font-mono" />
              <button onClick={() => copy(metadataUrl)} className="rounded border px-2 py-1 hover:bg-neutral-100">
                コピー
              </button>
            </div>
          </div>
          <div>
            <div className="text-neutral-500">Issuer / Entity ID</div>
            <div className="mt-0.5 flex gap-2">
              <input readOnly value={issuer} className="min-w-0 flex-1 rounded border bg-neutral-50 px-2 py-1 font-mono" />
              <button onClick={() => copy(issuer)} className="rounded border px-2 py-1 hover:bg-neutral-100">
                コピー
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordSection({
  settings,
  onSettings,
}: {
  settings: SecuritySettings;
  onSettings: (settings: SecuritySettings) => void;
}) {
  const [minLength, setMinLength] = useState(String(settings.password_min_length));
  const [upper, setUpper] = useState(settings.password_require_upper);
  const [lower, setLower] = useState(settings.password_require_lower);
  const [number, setNumber] = useState(settings.password_require_number);
  const [symbol, setSymbol] = useState(settings.password_require_symbol);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const data = await api<{ settings: SecuritySettings }>("/api/admin/security", "PATCH", {
        password_min_length: Number(minLength),
        password_require_upper: upper,
        password_require_lower: lower,
        password_require_number: number,
        password_require_symbol: symbol,
      });
      onSettings(data.settings);
      setMsg("パスワード強度の設定を保存しました");
    } catch (e) {
      setMsg(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-security-section="password">
      <SectionHeader
        title="パスワード強度"
        description="全員のパスワード要件を設定します。変更は新しく作成されるパスワードのみに適用されます。"
      />
      <div className="mt-4 max-w-xl rounded-lg border border-neutral-200 p-4">
        <label className="text-xs text-neutral-600">
          最小文字数
          <input
            type="number"
            min={8}
            max={64}
            value={minLength}
            onChange={(e) => setMinLength(e.target.value)}
            className="mt-1 w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            data-password-min-length
          />
          <span className="mt-1 block text-[11px] text-neutral-400">
            メンバーとゲストのパスワードは、{minLength || 8} 文字以上である必要があります。
          </span>
        </label>
        <div className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} />
            大文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} />
            小文字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={number} onChange={(e) => setNumber(e.target.checked)} />
            数字を含む
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={symbol} onChange={(e) => setSymbol(e.target.checked)} />
            記号を含む
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            data-password-save
            className="rounded bg-[#4075cf] px-3 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更内容を保存"}
          </button>
          {msg && <span className="text-sm text-neutral-600">{msg}</span>}
        </div>
      </div>
      <div className="mt-3 max-w-xl rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        パスワードはユーザー作成、管理者による再設定、招待の承諾、プロフィールからの変更時に検証されます。
      </div>
    </div>
  );
}

export default function SecurityPanel({
  initialSettings,
  initialRoles,
  initialTotpUsers,
  permissions,
  currentUserId,
}: {
  initialSettings: SecuritySettings;
  initialRoles: AdminRole[];
  initialTotpUsers: TotpUserRow[];
  permissions: string[];
  currentUserId: number;
}) {
  const sections = (["rbac", "two-factor", "saml", "password"] as const).filter((key) => {
    if (key === "rbac") return permissions.includes("roles.manage");
    return permissions.includes("security.manage");
  });
  const [section, setSection] = useState<SectionKey>(sections[0] ?? "rbac");
  const [settings, setSettings] = useState(initialSettings);
  const [totpUsers, setTotpUsers] = useState(initialTotpUsers);

  const updateSettings = (next: SecuritySettings, users?: TotpUserRow[]) => {
    setSettings(next);
    if (users) setTotpUsers(users);
  };

  if (sections.length === 0) {
    return <p className="text-sm text-neutral-500">セキュリティ設定を表示する権限がありません。</p>;
  }

  return (
    <section data-admin-panel="security">
      <h2 className="text-base font-semibold">セキュリティ</h2>
      <p className="mt-0.5 text-xs text-neutral-500">
        認証、役割、パスワードのポリシーを管理します。設定はワークスペース全体に適用されます。
      </p>

      <div className="mt-4 flex flex-wrap gap-1 border-b">
        {sections.map((key) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            data-security-tab={key}
            className={`-mb-px rounded-t px-3 py-2 text-sm ${
              section === key
                ? "border-b-2 border-[#4075cf] font-medium text-[#2f5fa8]"
                : "text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            {SECTION_LABEL[key]}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {section === "rbac" && permissions.includes("roles.manage") && (
          <RbacSection initialRoles={initialRoles} />
        )}
        {section === "two-factor" && permissions.includes("security.manage") && (
          <TwoFactorSection
            settings={settings}
            totpUsers={totpUsers}
            onSettings={updateSettings}
            currentUserId={currentUserId}
          />
        )}
        {section === "saml" && permissions.includes("security.manage") && (
          <SamlSection settings={settings} onSettings={(next) => updateSettings(next)} />
        )}
        {section === "password" && permissions.includes("security.manage") && (
          <PasswordSection settings={settings} onSettings={(next) => updateSettings(next)} />
        )}
      </div>
    </section>
  );
}
