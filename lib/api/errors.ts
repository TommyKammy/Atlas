import { NextResponse } from "next/server";

/** Structured API error; route wrappers turn this into a JSON response. */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = "api_error", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, "bad_request", details);
export const unauthorized = (message = "unauthenticated") =>
  new ApiError(401, message, "unauthorized");
export const forbidden = (message = "forbidden") =>
  new ApiError(403, message, "forbidden");
export const notFound = (message = "not found") =>
  new ApiError(404, message, "not_found");
export const conflict = (message = "conflict", details?: unknown) =>
  new ApiError(409, message, "conflict", details);

export function jsonError(error: unknown): Response {
  const dbError = error as { code?: string; constraint?: string } | null;
  if (dbError?.code === "23514" && dbError.constraint === "task_project_cascade_guard") {
    return NextResponse.json({ error: "task hierarchy crosses projects", code: "conflict" }, { status: 409 });
  }
  if (dbError?.code === "23503" && (
    dbError.constraint === "tasks_section_project_fkey" ||
    dbError.constraint === "task_memberships_section_project_fkey"
  )) {
    return NextResponse.json({ error: "section does not belong to project", code: "bad_request" }, { status: 400 });
  }
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.details !== undefined) body.details = error.details;
    return NextResponse.json(body, { status: error.status });
  }
  console.error("unhandled API error", error);
  return NextResponse.json({ error: "internal server error", code: "internal_error" }, { status: 500 });
}
