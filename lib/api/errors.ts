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
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.details !== undefined) body.details = error.details;
    return NextResponse.json(body, { status: error.status });
  }
  console.error("unhandled API error", error);
  return NextResponse.json({ error: "internal server error", code: "internal_error" }, { status: 500 });
}
