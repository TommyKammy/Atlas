import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/route";
import {
  getSearchHistory,
  getWorkspace,
  searchFilesGlobal,
  searchKnowledgeGlobal,
  searchMessagesGlobal,
  searchProjectsGlobal,
  searchTasksAdvanced,
  type AdvancedSearchFilters,
} from "@/lib/data";

export const GET = withUser(async (req, { uid }) => {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 200);
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ history: [], groups: {} });
  if (q === "") {
    return NextResponse.json({ history: await getSearchHistory(uid), groups: {} });
  }
  const filters: AdvancedSearchFilters = {
    q,
    projectId: null,
    assigneeId: null,
    completed: "all",
    status: null,
    dueFrom: null,
    dueTo: null,
    createdFrom: null,
    createdTo: null,
    completedFrom: null,
    completedTo: null,
    custom: [],
  };
  const [tasks, projects, messages, knowledge, files] = await Promise.all([
    searchTasksAdvanced(ws.id, filters, uid),
    searchProjectsGlobal(ws.id, q, uid),
    searchMessagesGlobal(ws.id, q, uid),
    searchKnowledgeGlobal(ws.id, q, uid),
    searchFilesGlobal(ws.id, q, uid),
  ]);
  return NextResponse.json({
    history: [],
    groups: {
      tasks: tasks.slice(0, 5).map((task) => ({
        id: task.id,
        name: task.name,
        project_id: task.project_id,
        project_name: task.project_name,
      })),
      projects: projects.slice(0, 5).map((project) => ({ id: project.id, name: project.name })),
      messages: messages.slice(0, 5).map((message) => ({
        id: message.id,
        title: message.title,
        project_id: message.project_id,
        project_name: message.project_name,
      })),
      knowledge: knowledge.slice(0, 5).map((note) => ({
        id: note.id,
        title: note.title,
        project_id: note.project_id,
        project_name: note.project_name,
      })),
      files: files.slice(0, 5).map((file) => ({
        id: file.id,
        file_name: file.file_name,
        task_id: file.task_id,
        project_id: file.project_id,
        project_name: file.project_name,
      })),
    },
  });
});
