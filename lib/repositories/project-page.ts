import { getProjectKnowledge, type DataActor } from "../services/authorized-data";
import { cache } from "react";
import { getDashboardTasks, getDashboardWidgets } from "../dashboard";
import { getProjectRules } from "../automation/repository";
import {
  getBundlesForProject,
  getCustomFields,
  getDependencies,
  getProjectActivity,
  getProjectApps,
  getProjectMembers,
  getProjectMessages,
  getProjectForms,
  getProjectAttachments,
  getProjectStats,
  getProjectTabs,
  getProjectTaskOptions,
  getProjectTasks,
  getTimelineTasks,
  getSavedViews,
  getSections,
  getSubtasks,
  getSubtasksBulk,
  getTaskAttachments,
  getTaskCustomValues,
  getTaskDependencies,
  getTaskEvents,
  getTaskProjects,
  getUsers,
  getComments,
  getCommentReactions,
  isFavorite,
} from "../data";

/**
 * Data needed by the project header, tabs, customize drawer and task pane
 * regardless of the active view. Cached per request.
 */
export const getProjectShellData = cache(async (projectId: number, viewerId: number) => {
  const [sections, users, members, projectTabs, customFields, projectApps, projectBundles, projectRules, favorite] =
    await Promise.all([
      getSections(projectId),
      getUsers(),
      getProjectMembers(projectId),
      getProjectTabs(projectId),
      getCustomFields(projectId),
      getProjectApps(projectId),
      getBundlesForProject(projectId),
      getProjectRules(projectId, viewerId),
      isFavorite(viewerId, projectId),
    ]);
  return {
    sections,
    users,
    members,
    projectTabs,
    customFields,
    projectApps,
    projectBundles,
    projectRules,
    favorite,
  };
});

export async function getListViewData(projectId: number) {
  const [tasks, customValues, savedViews, subtaskMap] = await Promise.all([
    getProjectTasks(projectId),
    getTaskCustomValues(projectId),
    getSavedViews(projectId),
    getSubtasksBulk(projectId),
  ]);
  return { tasks, customValues, savedViews, subtaskMap };
}

export async function getBoardViewData(projectId: number) {
  const tasks = await getProjectTasks(projectId);
  return { tasks };
}

export async function getTimelineViewData(projectId: number) {
  const [tasks, deps] = await Promise.all([getTimelineTasks(projectId), getTaskDependencies(projectId)]);
  return { tasks, deps };
}

export async function getCalendarViewData(projectId: number) {
  const [tasks, customValues] = await Promise.all([
    getProjectTasks(projectId),
    getTaskCustomValues(projectId),
  ]);
  return { tasks, customValues };
}

export async function getOverviewViewData(projectId: number) {
  const [stats, activity] = await Promise.all([getProjectStats(projectId), getProjectActivity(projectId)]);
  return { stats, activity };
}

export async function getDashboardViewData(projectId: number) {
  const [widgets, tasks] = await Promise.all([
    getDashboardWidgets(projectId),
    getDashboardTasks(projectId),
  ]);
  return { widgets, tasks };
}

export async function getMessagesViewData(projectId: number) {
  return { messages: await getProjectMessages(projectId) };
}

export async function getKnowledgeViewData(projectId: number, actor: DataActor, selectedNoteId?: number) {
  return { knowledge: await getProjectKnowledge(projectId, actor, selectedNoteId) };
}

export async function getFormsViewData(projectId: number) {
  return { forms: await getProjectForms(projectId) };
}

export async function getFilesViewData(projectId: number) {
  return { attachments: await getProjectAttachments(projectId) };
}

export async function getTaskPaneData(taskId: number, projectId: number, viewerId: number) {
  const [subtasks, comments, memberships, dependencies, taskOptions, attachments, reactions, events, customValues] =
    await Promise.all([
      getSubtasks(taskId, projectId),
      getComments(taskId),
      getTaskProjects(taskId),
      getDependencies(taskId),
      getProjectTaskOptions(projectId),
      getTaskAttachments(taskId),
      getCommentReactions(taskId, viewerId),
      getTaskEvents(taskId),
      getTaskCustomValues(projectId),
    ]);
  return {
    subtasks,
    comments,
    memberships,
    dependencies,
    taskOptions,
    attachments,
    reactions,
    events,
    customValues,
  };
}
