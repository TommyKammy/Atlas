export type ApiPayload = Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Shared JSON client. Supports both api(path, method, body) and
 * api(path, { method, body, signal }).
 */
export async function api<T = ApiPayload>(
  path: string,
  methodOrOptions: string | ApiOptions = "GET",
  body?: unknown,
): Promise<T> {
  const options: ApiOptions =
    typeof methodOrOptions === "string" ? { method: methodOrOptions, body } : methodOrOptions;
  const method = options.method ?? "GET";
  const hasBody = options.body !== undefined;
  const res = await fetch(path, {
    method,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error)
        : `${method} ${path}: ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}
