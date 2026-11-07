import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireActiveUser,
  requireProjectPermission,
  requireTaskPermission,
  requireWorkspaceAdmin,
  type ProjectPermission,
} from "@/lib/api-project-auth";
import type { ProjectRole } from "@/lib/project-roles";
import { ApiError, badRequest, jsonError, notFound } from "./errors";

type Params = Record<string, string>;
type RouteContext<P extends Params = Params> = { params: Promise<P> };

export type UserContext<P extends Params = Params> = {
  uid: number;
  params: P;
};

export type ProjectContext<P extends Params = Params> = UserContext<P> & {
  projectId: number;
  role: ProjectRole;
  workspaceAdmin: boolean;
  body: unknown;
};

export type ProjectOptions<P extends Params = Params> = {
  /** Parse the JSON body once and pass it to the handler. */
  body?: boolean;
  /** Custom project resolver (e.g. owner lookup for /resource/[id] routes). */
  resolveProjectId?: (req: NextRequest, params: P, body: unknown) => number | Promise<number>;
};

function projectIdFromBody(body: unknown): unknown {
  if (body && typeof body === "object" && "project_id" in body) {
    return (body as { project_id?: unknown }).project_id;
  }
  return undefined;
}

export type TaskContext<P extends Params = Params> = UserContext<P> & {
  taskId: number;
  projectId: number | null;
  body: unknown;
};

export type TaskOptions<P extends Params = Params> = {
  body?: boolean;
  resolveTaskId?: (req: NextRequest, params: P, body: unknown) => number | Promise<number>;
};

function taskIdFromBody(body: unknown): unknown {
  if (body && typeof body === "object" && "task_id" in body) {
    return (body as { task_id?: unknown }).task_id;
  }
  return undefined;
}

function positiveId(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`invalid ${label}`);
  return n;
}

async function readParams<P extends Params>(context?: RouteContext<P>): Promise<P> {
  return context?.params ? context.params : ({} as P);
}

/** Resolve the active session for user-scoped routes. */
export function withUser<P extends Params = Params>(
  handler: (req: NextRequest, ctx: UserContext<P>) => Promise<Response>,
  options?: { inactiveStatus?: 403 | 404 },
) {
  return async (req: NextRequest, context?: RouteContext<P>): Promise<Response> => {
    try {
      const auth = await requireActiveUser(req);
      if (!auth.ok) throw new ApiError(options?.inactiveStatus ?? auth.status, auth.error, "forbidden");
      return await handler(req, { uid: auth.uid, params: await readParams(context) });
    } catch (error) {
      return jsonError(error);
    }
  };
}

/** Resolve a workspace administrator for admin routes. */
export function withAdmin<P extends Params = Params>(
  handler: (req: NextRequest, ctx: UserContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, context?: RouteContext<P>): Promise<Response> => {
    try {
      const auth = await requireWorkspaceAdmin(req);
      if (!auth.ok) throw new ApiError(auth.status, auth.error, "forbidden");
      return await handler(req, { uid: auth.uid, params: await readParams(context) });
    } catch (error) {
      return jsonError(error);
    }
  };
}

/**
 * Resolve a project from params.id or ?project_id, verify existence first,
 * then enforce the requested role. Pass a resolver for body-based project ids.
 */
export function withProject<P extends Params = Params>(
  level: ProjectPermission,
  handler: (req: NextRequest, ctx: ProjectContext<P>) => Promise<Response>,
  options?: ProjectOptions<P>,
) {
  return async (req: NextRequest, context?: RouteContext<P>): Promise<Response> => {
    try {
      const params = await readParams(context);
      const body = options?.body ? await req.json().catch(() => null) : undefined;
      const raw = options?.resolveProjectId
        ? await options.resolveProjectId(req, params, body)
        : (params.id ?? new URL(req.url).searchParams.get("project_id") ?? projectIdFromBody(body));
      const projectId = positiveId(raw, "project_id");
      const exists = await db.query("SELECT id FROM projects WHERE id = $1::bigint", [projectId]);
      if (exists.rowCount === 0) throw new ApiError(404, "project not found", "not_found");
      const auth = await requireProjectPermission(req, projectId, level);
      if (!auth.ok) throw new ApiError(auth.status, auth.error, "forbidden");
      return await handler(req, {
        uid: auth.uid,
        projectId,
        role: auth.role,
        workspaceAdmin: auth.workspaceAdmin,
        params,
        body,
      });
    } catch (error) {
      return jsonError(error);
    }
  };
}

/**
 * Resolve a project from a resource row's project_id.
 * The table list is closed to prevent dynamic SQL injection.
 */
export function withResourceProject<P extends Params = Params>(
  level: ProjectPermission,
  table:
    | "custom_fields"
    | "project_knowledge"
    | "project_forms"
    | "project_tabs"
    | "saved_views"
    | "sections"
    | "task_templates",
  handler: (req: NextRequest, ctx: ProjectContext<P>) => Promise<Response>,
  options?: { body?: boolean },
) {
  return withProject(level, handler, {
    body: options?.body,
    resolveProjectId: async (_req, params) => {
      const row = await db.query(`SELECT project_id FROM ${table} WHERE id = $1::bigint`, [params.id]);
      if (row.rowCount === 0) throw notFound();
      const projectId = Number(row.rows[0].project_id);
      if (!Number.isInteger(projectId) || projectId <= 0) throw notFound();
      return projectId;
    },
  });
}

/** Resolve a task from params.id or ?task_id and enforce project/task access. */
export function withTask<P extends Params = Params>(
  level: ProjectPermission,
  handler: (req: NextRequest, ctx: TaskContext<P>) => Promise<Response>,
  options?: TaskOptions<P>,
) {
  return async (req: NextRequest, context?: RouteContext<P>): Promise<Response> => {
    try {
      const params = await readParams(context);
      const body = options?.body ? await req.json().catch(() => null) : undefined;
      const raw = options?.resolveTaskId
        ? await options.resolveTaskId(req, params, body)
        : (params.id ?? new URL(req.url).searchParams.get("task_id") ?? taskIdFromBody(body));
      const taskId = positiveId(raw, "task_id");
      const auth = await requireTaskPermission(req, taskId, level);
      if (!auth.ok) throw new ApiError(auth.status, auth.error, "not_found");
      return await handler(req, { uid: auth.uid, taskId, projectId: auth.projectId, params, body });
    } catch (error) {
      return jsonError(error);
    }
  };
}

/** Resolve a task from an attachment row (attachment id in params.id). */
export function withAttachmentTask<P extends Params = Params>(
  level: ProjectPermission,
  handler: (req: NextRequest, ctx: TaskContext<P>) => Promise<Response>,
) {
  return withTask(level, handler, {
    resolveTaskId: async (_req, params) => {
      const row = await db.query("SELECT task_id FROM task_attachments WHERE id = $1::bigint", [params.id]);
      if (row.rowCount === 0) throw notFound();
      return Number(row.rows[0].task_id);
    },
  });
}

/** Resolve a comment's task project for comment-scoped routes. */
export function withCommentProject<P extends Params = Params>(
  level: ProjectPermission,
  handler: (req: NextRequest, ctx: ProjectContext<P>) => Promise<Response>,
  options?: { body?: boolean },
) {
  return withProject(level, handler, {
    body: options?.body,
    resolveProjectId: async (_req, params) => {
      const row = await db.query(
        `SELECT t.project_id FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = $1::bigint`,
        [params.id],
      );
      if (row.rowCount === 0) throw notFound();
      const projectId = Number(row.rows[0].project_id);
      if (!Number.isInteger(projectId) || projectId <= 0) throw notFound();
      return projectId;
    },
  });
}
