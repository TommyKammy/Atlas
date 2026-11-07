import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { ensureSecuritySettings, getSecuritySettings, getTotpUsers } from "@/lib/admin-data";

const TWO_FACTOR = new Set(["optional", "required"]);
const SAML_MODES = new Set(["off", "optional", "required", "members_only"]);

export const GET = withAdminPermission("security.manage", async () => {
  const settings = await getSecuritySettings();
  return NextResponse.json({
    settings,
    totpUsers: await getTotpUsers(settings.workspace_id),
  });
});

export const PATCH = withAdminPermission("security.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const current = await getSecuritySettings();
  const sets: string[] = [];
  const values: unknown[] = [];
  const next = { ...current };

  if (body?.two_factor_policy !== undefined) {
    if (!TWO_FACTOR.has(body.two_factor_policy)) {
      return NextResponse.json({ error: "invalid two-factor policy" }, { status: 400 });
    }
    next.two_factor_policy = body.two_factor_policy;
    values.push(next.two_factor_policy);
    sets.push(`two_factor_policy = $${values.length}`);
  }
  if (body?.saml_mode !== undefined) {
    if (!SAML_MODES.has(body.saml_mode)) {
      return NextResponse.json({ error: "invalid SAML mode" }, { status: 400 });
    }
    next.saml_mode = body.saml_mode;
    values.push(next.saml_mode);
    sets.push(`saml_mode = $${values.length}`);
  }
  if (body?.saml_signin_url !== undefined) {
    const url = typeof body.saml_signin_url === "string" ? body.saml_signin_url.trim().slice(0, 1000) : "";
    if (url !== "") {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      } catch {
        return NextResponse.json({ error: "SAML sign-in URL must be http(s)" }, { status: 400 });
      }
    }
    next.saml_signin_url = url;
    values.push(url);
    sets.push(`saml_signin_url = $${values.length}`);
  }
  if (body?.saml_certificate !== undefined) {
    const cert = typeof body.saml_certificate === "string" ? body.saml_certificate.trim().slice(0, 20_000) : "";
    next.saml_certificate = cert;
    values.push(cert);
    sets.push(`saml_certificate = $${values.length}`);
  }
  if (body?.saml_session_days !== undefined) {
    const days = Number(body.saml_session_days);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      return NextResponse.json({ error: "SAML session days must be 1-30" }, { status: 400 });
    }
    next.saml_session_days = days;
    values.push(days);
    sets.push(`saml_session_days = $${values.length}`);
  }
  if (body?.saml_jit_provisioning !== undefined) {
    if (typeof body.saml_jit_provisioning !== "boolean") {
      return NextResponse.json({ error: "invalid JIT setting" }, { status: 400 });
    }
    next.saml_jit_provisioning = body.saml_jit_provisioning;
    values.push(next.saml_jit_provisioning);
    sets.push(`saml_jit_provisioning = $${values.length}`);
  }
  if (body?.password_min_length !== undefined) {
    const length = Number(body.password_min_length);
    if (!Number.isInteger(length) || length < 8 || length > 64) {
      return NextResponse.json({ error: "password minimum length must be 8-64" }, { status: 400 });
    }
    next.password_min_length = length;
    values.push(length);
    sets.push(`password_min_length = $${values.length}`);
  }
  for (const key of [
    "password_require_upper",
    "password_require_lower",
    "password_require_number",
    "password_require_symbol",
  ] as const) {
    if (body?.[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return NextResponse.json({ error: `invalid ${key}` }, { status: 400 });
      }
      next[key] = body[key];
      values.push(body[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (next.saml_mode !== "off") {
    if (!next.saml_signin_url || !next.saml_certificate) {
      return NextResponse.json(
        { error: "SAML sign-in URL and X.509 certificate are required when SAML is enabled" },
        { status: 400 },
      );
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  values.push(current.workspace_id);
  await db.query(
    `UPDATE workspace_security SET ${sets.join(", ")}, updated_at = now()
     WHERE workspace_id = $${values.length}`,
    values,
  );
  await audit(uid, "security.update", {
    entity: "workspace_security",
    entityId: current.workspace_id,
    summary: sets.join(", "),
  });
  const settings = await ensureSecuritySettings(current.workspace_id);
  return NextResponse.json({ settings, totpUsers: await getTotpUsers(settings.workspace_id) });
});
