import { unauthorized } from "./api/errors";

/** Obtain this identity from the authenticated session, never request JSON. */
export type DataActor = Readonly<{ userId: number }>;

export function assertDataActor(actor: DataActor): void {
  if (!actor || !Number.isSafeInteger(actor.userId) || actor.userId <= 0) {
    throw unauthorized("データの取得にはログインした利用者が必要です");
  }
}

/** SQL aliases and placeholders are internal constants, never user input.
 * Re-evaluate live membership and account status in the data query itself.
 */
export function projectDataAccess(projectAlias: string, userParam: string, level: "view" | "edit" | "admin" = "view"): string {
  const roles = {
    admin: "'admin'",
    edit: "'admin', 'editor', 'member'",
    view: "'admin', 'editor', 'member', 'commenter', 'viewer'",
  }[level];
  return `EXISTS (SELECT 1 FROM users data_actor
    WHERE data_actor.id = ${userParam} AND data_actor.deactivated_at IS NULL
      AND (data_actor.is_admin OR EXISTS (
        SELECT 1 FROM project_members data_member
        WHERE data_member.project_id = ${projectAlias}.id AND data_member.user_id = data_actor.id
          AND data_member.role IN (${roles})
      )))`;
}
