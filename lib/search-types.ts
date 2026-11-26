export type SuggestTask = {
  id: number;
  name: string;
  project_id: number;
  project_name: string;
  /** Issue key such as ATL-123, or null. */
  key?: string | null;
};
export type SuggestProject = { id: number; name: string };
export type SuggestMessage = { id: number; title: string; project_id: number; project_name: string };
export type SuggestKnowledge = { id: number; title: string; project_id: number; project_name: string };
export type SuggestFile = {
  id: number;
  file_name: string;
  task_id: number;
  project_id: number;
  project_name: string;
};

export type SearchSuggestData = {
  history: string[];
  groups: {
    tasks?: SuggestTask[];
    projects?: SuggestProject[];
    messages?: SuggestMessage[];
    knowledge?: SuggestKnowledge[];
    files?: SuggestFile[];
  };
};

export type SearchSuggestOption = {
  key: string;
  group: "history" | "tasks" | "projects" | "messages" | "knowledge" | "files";
  label: string;
  sublabel?: string;
  href: string;
};

export function searchOptionId(index: number): string {
  return `global-search-option-${index}`;
}

export function taskHref(task: SuggestTask): string {
  return `/projects/${task.project_id}?view=list&task=${task.id}`;
}
export function projectHref(project: SuggestProject): string {
  return `/projects/${project.id}?view=list`;
}
export function messageHref(message: SuggestMessage): string {
  return `/projects/${message.project_id}?view=messages`;
}
export function knowledgeHref(note: SuggestKnowledge): string {
  return `/projects/${note.project_id}?view=knowledge`;
}
export function fileHref(file: SuggestFile): string {
  return `/projects/${file.project_id}?view=list&task=${file.task_id}`;
}
export function historyHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

/** Flatten grouped suggestions into a keyboard-navigable option list. */
export function buildSearchOptions(data: SearchSuggestData, q: string): SearchSuggestOption[] {
  if (q === "") {
    return data.history.map((item) => ({
      key: `history-${item}`,
      group: "history" as const,
      label: item,
      href: historyHref(item),
    }));
  }
  const groups = data.groups ?? {};
  return [
    ...(groups.tasks ?? []).map((task) => ({
      key: `task-${task.id}`,
      group: "tasks" as const,
      label: task.key ? `${task.key} ${task.name}` : task.name,
      sublabel: task.project_name,
      href: taskHref(task),
    })),
    ...(groups.projects ?? []).map((project) => ({
      key: `project-${project.id}`,
      group: "projects" as const,
      label: project.name,
      href: projectHref(project),
    })),
    ...(groups.messages ?? []).map((message) => ({
      key: `message-${message.id}`,
      group: "messages" as const,
      label: message.title || "(件名なし)",
      sublabel: message.project_name,
      href: messageHref(message),
    })),
    ...(groups.knowledge ?? []).map((note) => ({
      key: `knowledge-${note.id}`,
      group: "knowledge" as const,
      label: note.title,
      sublabel: note.project_name,
      href: knowledgeHref(note),
    })),
    ...(groups.files ?? []).map((file) => ({
      key: `file-${file.id}`,
      group: "files" as const,
      label: file.file_name,
      sublabel: file.project_name,
      href: fileHref(file),
    })),
  ];
}
