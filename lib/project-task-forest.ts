import { compatibleTaskParent } from "./repositories/scope";

export type TaskForestQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export type ProjectTaskForestRow = {
  id: number;
  project_id: number | null;
  section_id: number | null;
  parent_task_id: number | null;
  name: string;
  description: string;
  description_doc: unknown;
  assignee_id: number | null;
  completed: boolean;
  completed_at: string | null;
  start_on: string | null;
  due_on: string | null;
  progress: number;
  status: string;
  position: number;
  recurrence: string;
  is_milestone: boolean;
};

export type ProjectTaskForestNode = ProjectTaskForestRow & {
  /** Section used for this project, including secondary multi-homes. */
  effective_section_id: number | null;
  depth: number;
};

const COLUMNS = `t.id, t.project_id, t.section_id, t.parent_task_id, t.name,
  t.description, t.description_doc, t.assignee_id, t.completed,
  t.completed_at::text AS completed_at, t.start_on::text AS start_on,
  t.due_on::text AS due_on, t.progress, t.status, t.position, t.recurrence, t.is_milestone`;

type RootRow = ProjectTaskForestRow & { membership_section_id: number | null };

/**
 * Load the task forest visible in a project.
 *
 * Seed from primary and secondary homes. Descendants can inherit that
 * placement when they are projectless or share their parent's primary home.
 * A legacy link to a different primary project cannot grant visibility.
 */
export async function getProjectTaskForest(
  q: TaskForestQueryable,
  projectId: number,
): Promise<ProjectTaskForestNode[]> {
  const roots = await q.query(
    `SELECT ${COLUMNS}, m.section_id AS membership_section_id
     FROM tasks t
     LEFT JOIN task_project_memberships m
       ON m.task_id = t.id AND m.project_id = $1::bigint
     WHERE (t.project_id = $1::bigint OR m.project_id = $1::bigint)
       AND t.deleted_at IS NULL
     ORDER BY t.position, t.id`,
    [projectId],
  );

  const nodes = new Map<number, ProjectTaskForestNode>();
  for (const row of roots.rows as RootRow[]) {
    const effective =
      row.project_id === projectId ? row.section_id : row.membership_section_id;
    nodes.set(Number(row.id), {
      ...row,
      id: Number(row.id),
      project_id: row.project_id === null ? null : Number(row.project_id),
      section_id: row.section_id === null ? null : Number(row.section_id),
      parent_task_id: row.parent_task_id === null ? null : Number(row.parent_task_id),
      assignee_id: row.assignee_id === null ? null : Number(row.assignee_id),
      effective_section_id: effective === null ? null : Number(effective),
      depth: 0,
    });
  }

  let frontier = [...nodes.keys()];
  while (frontier.length > 0) {
    const children = await q.query(
      `SELECT ${COLUMNS}
       FROM tasks t
       JOIN tasks parent ON parent.id = t.parent_task_id
       WHERE t.parent_task_id = ANY($1::bigint[]) AND t.deleted_at IS NULL
         AND ${compatibleTaskParent("t", "parent")}
       ORDER BY t.position, t.id`,
      [frontier],
    );
    const next: number[] = [];
    for (const row of children.rows as ProjectTaskForestRow[]) {
      const id = Number(row.id);
      if (nodes.has(id)) continue;
      const parentId = row.parent_task_id === null ? null : Number(row.parent_task_id);
      const parent = parentId === null ? null : nodes.get(parentId);
      if (!parent) continue;
      nodes.set(id, {
        ...row,
        id,
        project_id: row.project_id === null ? null : Number(row.project_id),
        section_id: row.section_id === null ? null : Number(row.section_id),
        parent_task_id: parentId,
        assignee_id: row.assignee_id === null ? null : Number(row.assignee_id),
        effective_section_id: parent.effective_section_id,
        depth: 0,
      });
      next.push(id);
    }
    frontier = next;
  }

  // A projected subtask can already be present in the initial query, with a
  // position lower than its parent's. Derive depth from the finished forest.
  const children = new Map<number, ProjectTaskForestNode[]>();
  const parents: ProjectTaskForestNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parent_task_id;
    if (parentId === null || !nodes.has(parentId)) {
      parents.push(node);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(node);
    children.set(parentId, siblings);
  }
  for (const parent of parents) {
    for (const child of children.get(parent.id) ?? []) {
      child.depth = parent.depth + 1;
      parents.push(child);
    }
  }

  return [...nodes.values()].sort(
    (a, b) => a.depth - b.depth || a.position - b.position || a.id - b.id,
  );
}
