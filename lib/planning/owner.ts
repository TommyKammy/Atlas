import { badRequest } from "../api/errors";
import type { Queryable } from "../db";

export type InitiativeOwner = {
  ownerMemberId: number | null;
  ownerName: string;
};

export type PlannedOwnerChange =
  | { mode: "keep"; ownerMemberId: number | null; ownerName: string }
  | { mode: "member"; ownerMemberId: number };

/**
 * Decide how an initiative update treats its owner.
 *
 * A selected member may be retained even after that account is deactivated:
 * the stored name is kept byte-for-byte and no directory lookup or rewrite
 * happens. Legacy free text is retained only when the client echoes the same
 * text; it can never be replaced with arbitrary new free text. Choosing a
 * different member deliberately replaces the name with that member's current
 * name after the mutation validates an active account.
 */
export function planInitiativeOwnerChange(
  existing: InitiativeOwner,
  requestedMemberId: number | null | undefined,
  requestedLegacyName?: string | null,
): PlannedOwnerChange {
  const keepsExisting = requestedMemberId === undefined || requestedMemberId === existing.ownerMemberId;
  if (keepsExisting) {
    if (
      existing.ownerMemberId === null &&
      requestedLegacyName !== undefined &&
      requestedLegacyName !== null &&
      requestedLegacyName.trim() !== existing.ownerName.trim()
    ) {
      throw badRequest("起案責任者はメンバー一覧から選択してください");
    }
    return {
      mode: "keep",
      ownerMemberId: existing.ownerMemberId,
      ownerName: existing.ownerName,
    };
  }
  if (requestedMemberId === null) {
    throw badRequest("起案責任者を選択してください");
  }
  return { mode: "member", ownerMemberId: requestedMemberId };
}

/**
 * Resolve a new owner from the active workspace directory at save time.
 *
 * Atlas currently provisions one workspace, but the validation still anchors
 * the member to that workspace through workspace_roles when one is assigned.
 * The caller has already authorized the editor against the portfolio's
 * workspace. Selecting an owner grants no project or plan visibility.
 */
export async function resolveActiveInitiativeOwner(
  q: Queryable,
  workspaceId: number,
  memberId: number,
): Promise<{ ownerMemberId: number; ownerName: string }> {
  const result = await q.query(
    `SELECT u.id, u.name
     FROM users u
     JOIN workspaces w ON w.id = $1::bigint
     WHERE u.id = $2::bigint
       AND u.deactivated_at IS NULL
       AND (
         u.role_id IS NULL
         OR EXISTS (
           SELECT 1 FROM workspace_roles r
           WHERE r.id = u.role_id AND r.workspace_id = w.id
         )
       )`,
    [workspaceId, memberId],
  );
  if (result.rowCount === 0) {
    throw badRequest("指定した起案責任者は存在しないか無効です");
  }
  const ownerName = String(result.rows[0].name);
  if (ownerName.trim() === "" || ownerName.length > 120) {
    throw badRequest("指定した起案責任者の名前が正しくありません");
  }
  return {
    ownerMemberId: Number(result.rows[0].id),
    ownerName,
  };
}
