import { db } from "./db";
import type { AutomationTrigger, ProjectAutomation } from "./automations";

/** Execute enabled project automations for a task event. */
export async function runAutomations(
  projectId: number | null,
  taskId: number,
  trigger: AutomationTrigger,
): Promise<number> {
  if (projectId === null) return 0;
  const rules = await db.query(
    `SELECT id, project_id, name, trigger, action_type, action_value, enabled,
            created_at::text AS created_at, updated_at::text AS updated_at
     FROM project_automations
     WHERE project_id = $1 AND trigger = $2 AND enabled = true
     ORDER BY id`,
    [projectId, trigger],
  );
  let runs = 0;
  for (const rule of rules.rows as ProjectAutomation[]) {
    const value = rule.action_value.trim();
    if (value === "") continue;
    if (rule.action_type === "set_status") {
      await db.query("UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2::bigint", [
        value,
        taskId,
      ]);
    } else if (rule.action_type === "set_assignee") {
      const assignee = Number(value);
      if (!Number.isInteger(assignee) || assignee <= 0) continue;
      await db.query("UPDATE tasks SET assignee_id = $1, updated_at = now() WHERE id = $2::bigint", [
        assignee,
        taskId,
      ]);
    } else if (rule.action_type === "add_comment") {
      await db.query(
        "INSERT INTO comments (task_id, author_id, body) VALUES ($1::bigint, $2, $3)",
        [taskId, null, value],
      );
    } else {
      continue;
    }
    await db.query(
      "INSERT INTO automation_runs (automation_id, task_id, trigger, action_type) VALUES ($1::bigint, $2::bigint, $3, $4)",
      [rule.id, taskId, trigger, rule.action_type],
    );
    runs += 1;
  }
  return runs;
}
