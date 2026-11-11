import { normalizeProjectSettings } from "./project-settings";
import { canManageProject, type ProjectRole } from "./project-roles";

/** Project configuration is separate from editing tasks and comments. */
export function canConfigureProject(role: ProjectRole | null, settings: unknown): boolean {
  return canManageProject(role) || role === "editor" && normalizeProjectSettings(settings).who_can_edit === "editors";
}

export function canShareProject(role: ProjectRole | null, settings: unknown): boolean {
  return canManageProject(role) || role === "editor" && normalizeProjectSettings(settings).who_can_share === "editors";
}

/** Delegated sharing never grants control over admins or the actor's own role. */
export function canChangeProjectMember(
  actorRole: ProjectRole,
  actorId: number,
  targetId: number,
  currentRole: ProjectRole | null,
  nextRole: ProjectRole | null,
  targetWorkspaceAdmin = false,
): boolean {
  return actorRole === "admin" || actorRole === "editor" && actorId !== targetId &&
    currentRole !== "admin" && nextRole !== "admin" && !targetWorkspaceAdmin;
}

export function projectPatchRequiresAdmin(body: Record<string, unknown>): boolean {
  return ["settings", "owner_id", "team_id", "archived"].some((key) => key in body);
}
