import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { forbidden } from "@/lib/api/errors";
import { withAdminPermission } from "@/lib/api/route";
import { getEffectiveRole } from "@/lib/permissions";
import { getSecuritySettings, getTotpUsers, type SecuritySettings } from "@/lib/admin-data";

const TWO_FACTOR = new Set(["optional", "required"]);
const SAML_MODES = new Set(["off", "optional", "required", "members_only"]);

export const GET = withAdminPermission("security.manage", async (_req, { uid }) => {
  const settings = await getSecuritySettings();
  return NextResponse.json({
    settings,
    totpUsers: await getTotpUsers(settings.workspace_id, uid),
  });
});

export const PATCH = withAdminPermission("security.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  if (body?.scim_enabled !== undefined || body?.mcp_enabled !== undefined || body?.mcp_pat_enabled !== undefined) {
    const role = await getEffectiveRole(uid);
    if (role?.isSuper !== true) {
      if (body?.scim_enabled !== undefined) throw forbidden("super administrator required to change SCIM");
      throw forbidden("super administrator required to change MCP");
    }
  }
  const workspaceId = (await getSecuritySettings()).workspace_id;
  const outcome = await withTransaction(async (q) => {
    // Merge and validate under the same lock used by the session policy trigger.
    // Concurrent settings saves cannot validate a stale certificate/mode pair.
    const locked = await q.query(`SELECT w.*,w.updated_at::text AS updated_at
      FROM workspace_security w WHERE workspace_id=$1 FOR UPDATE`, [workspaceId]);
    const current = locked.rows[0] as SecuritySettings;
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
    if (body?.scim_enabled !== undefined) {
      if (typeof body.scim_enabled !== "boolean") {
        return NextResponse.json({ error: "invalid SCIM setting" }, { status: 400 });
      }
      next.scim_enabled = body.scim_enabled;
      values.push(next.scim_enabled);
      sets.push(`scim_enabled = $${values.length}`);
    }
    if (body?.mcp_enabled !== undefined) {
      if (typeof body.mcp_enabled !== "boolean") {
        return NextResponse.json({ error: "invalid MCP setting" }, { status: 400 });
      }
      next.mcp_enabled = body.mcp_enabled;
      values.push(next.mcp_enabled);
      sets.push(`mcp_enabled = $${values.length}`);
    }
    if (body?.mcp_pat_enabled !== undefined) {
      if (typeof body.mcp_pat_enabled !== "boolean") {
        return NextResponse.json({ error: "invalid MCP PAT setting" }, { status: 400 });
      }
      next.mcp_pat_enabled = body.mcp_pat_enabled;
      values.push(next.mcp_pat_enabled);
      sets.push(`mcp_pat_enabled = $${values.length}`);
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
    const updated = await q.query(
      `UPDATE workspace_security SET ${sets.join(", ")}, updated_at = now()
       WHERE workspace_id = $${values.length} RETURNING *,updated_at::text AS updated_at`,
      values,
    );
    await audit(uid, "security.update", {
      entity: "workspace_security",
      entityId: current.workspace_id,
      summary: sets.join(", "),
    }, q);
    if (body?.scim_enabled !== undefined && body.scim_enabled !== current.scim_enabled) {
      await audit(uid, body.scim_enabled ? "security.scim_enable" : "security.scim_disable", {
        entity: "workspace_security",
        entityId: current.workspace_id,
        summary: body.scim_enabled ? "SCIM プロビジョニングを有効化" : "SCIM プロビジョニングを無効化",
      }, q);
    }
    if (body?.mcp_enabled !== undefined && body.mcp_enabled !== current.mcp_enabled) {
      await audit(uid, body.mcp_enabled ? "security.mcp_enable" : "security.mcp_disable", {
        entity: "workspace_security",
        entityId: current.workspace_id,
        summary: body.mcp_enabled ? "MCP 接続を有効化" : "MCP 接続を無効化",
      }, q);
    }
    if (body?.mcp_pat_enabled !== undefined && body.mcp_pat_enabled !== current.mcp_pat_enabled) {
      await audit(uid, body.mcp_pat_enabled ? "security.mcp_pat_enable" : "security.mcp_pat_disable", {
        entity: "workspace_security",
        entityId: current.workspace_id,
        summary: body.mcp_pat_enabled
          ? "MCP パーソナルアクセストークンを有効化"
          : "MCP パーソナルアクセストークンを無効化",
      }, q);
    }
    return updated.rows[0] as SecuritySettings;
  });
  if (outcome instanceof Response) return outcome;
  return NextResponse.json({ settings: outcome, totpUsers: await getTotpUsers(outcome.workspace_id, uid) });
});
