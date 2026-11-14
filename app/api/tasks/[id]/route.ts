import { requireProjectPermission } from "@/lib/api-project-auth";
import { withTask } from "@/lib/api/route";
import { TaskMutationFailure } from "@/lib/services/task-mutation-failure";
import { deleteTask, updateTask } from "@/lib/services/task-update";
import { NextResponse } from "next/server";

async function mutationResponse(run: () => Promise<unknown>): Promise<Response> {
  try {
    return NextResponse.json(await run());
  } catch (error) {
    if (!(error instanceof TaskMutationFailure)) throw error;
    const status = { invalid: 400, missing: 404, denied: 403, conflict: 409 }[error.reason];
    return NextResponse.json({ error: error.message, ...error.metadata }, { status });
  }
}

export const PATCH = withTask("edit", async (req, context) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  return mutationResponse(() => updateTask(body, {
    ...context,
    authorizeProject: async (projectId) => {
      const auth = await requireProjectPermission(req, projectId, "edit");
      if (!auth.ok) throw new TaskMutationFailure(auth.status === 404 ? "missing" : "denied", auth.error);
    },
  }));
});

export const DELETE = withTask("edit", async (req, context) =>
  mutationResponse(() => deleteTask({ force: new URL(req.url).searchParams.get("force") === "1" }, context)),
{ taskScope: "primary" });
