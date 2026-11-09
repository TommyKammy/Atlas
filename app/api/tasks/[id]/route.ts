import { withTask } from "@/lib/api/route";
import { deleteTask, updateTask } from "@/lib/services/task-update";

export const PATCH = withTask("edit", updateTask);

export const DELETE = withTask("edit", deleteTask, { taskScope: "primary" });
