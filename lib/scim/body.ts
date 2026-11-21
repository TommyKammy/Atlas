import { ScimApiError, invalidSyntax } from "./errors";

export const SCIM_MAX_BODY_BYTES = 1_048_576;

const ACCEPTED = new Set(["application/scim+json", "application/json"]);

/** Read a JSON object body, accepting both SCIM and plain JSON media types. */
export async function readScimJsonObject(req: Request): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "" && !ACCEPTED.has(contentType)) {
    throw new ScimApiError(415, `unsupported Content-Type: ${contentType}`);
  }
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > SCIM_MAX_BODY_BYTES) {
    throw new ScimApiError(413, "request body exceeds 1 MB");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > SCIM_MAX_BODY_BYTES) {
    throw new ScimApiError(413, "request body exceeds 1 MB");
  }
  if (bytes.byteLength === 0) throw invalidSyntax("request body is required");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidSyntax("request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSyntax("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}
