import { notFound } from "next/navigation";
import { getCurrentUserId } from "../current-user";
import { getProject, getProjectAccess } from "../data";
import { canEditProject } from "../project-roles";
import { getRuleDescriptors } from "./descriptors";
import { getRuleEditorDraft } from "./editor-drafts";
import { getProjectRules } from "./repository";

/** Load only scoped, redacted editor data into the client component. */
export async function loadRuleEditor(projectId: number, ruleId?: number, draftId?: string) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || (ruleId !== undefined && (!Number.isSafeInteger(ruleId) || ruleId <= 0))) notFound();
  if (draftId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) notFound();
  const viewerId = await getCurrentUserId();
  if (!viewerId) notFound();
  const access = await getProjectAccess(viewerId, projectId);
  if (!access.role) notFound();
  const project = await getProject(projectId);
  if (!project || project.deleted_at) notFound();
  const initialRule = ruleId === undefined ? null : (await getProjectRules(projectId, viewerId)).find((rule) => rule.id === ruleId) ?? null;
  if (ruleId !== undefined && !initialRule) notFound();
  const canEdit = canEditProject(access.role) && (!initialRule || initialRule.owner_id === viewerId);
  if (ruleId === undefined && !canEdit) notFound();
  const initialDraft = canEdit ? await getRuleEditorDraft(projectId, viewerId, draftId ? { draftId } : ruleId ? { ruleId } : {}) : null;
  if (draftId && !initialDraft) notFound();
  return { project: { id: projectId, name: project.name }, descriptors: await getRuleDescriptors(projectId, viewerId), initialRule, initialDraft, canEdit };
}
