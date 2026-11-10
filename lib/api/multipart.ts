import busboy, { type FileInfo } from "busboy";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApiError, badRequest } from "@/lib/api/errors";

const MULTIPART_OVERHEAD = 64 * 1024;

/** Parse one file with backpressure, exposing the fields received before its header. */
export async function receiveMultipart<T>(
  req: Request,
  maxFileBytes: number,
  fileLimitMessage: string,
  receiveFile: (stream: Readable, info: FileInfo, fields: ReadonlyMap<string, string>) => Promise<T>,
) {
  const tooLarge = new ApiError(413, fileLimitMessage, "payload_too_large");
  const maxRequestBytes = maxFileBytes + MULTIPART_OVERHEAD;
  const length = req.headers.get("content-length");
  if (length !== null && Number(length) > maxRequestBytes) throw tooLarge;

  const contentType = req.headers.get("content-type") ?? "";
  if (!req.body || !/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    throw badRequest("multipart form data is required");
  }
  let parser;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
      limits: { fileSize: maxFileBytes + 1, files: 1, fields: 8, fieldSize: 8192, parts: 10 },
    });
  } catch {
    throw badRequest("invalid multipart form data");
  }

  const reader = req.body.getReader();
  let requestBytes = 0;
  const source = new Readable({
    read() {
      void reader.read().then(({ done, value }) => {
        if (done) {
          this.push(null);
          return;
        }
        requestBytes += value.byteLength;
        if (requestBytes > maxRequestBytes) this.destroy(tooLarge);
        else this.push(value);
      }, (error: Error) => this.destroy(error));
    },
    destroy(error, callback) {
      // Cancelling the underlying Next request would close the client socket
      // before the route can return its 413. Stop reading without cancelling.
      reader.releaseLock();
      callback(error);
    },
  });

  const fields = new Map<string, string>();
  let file: T | undefined;
  let fileWork: Promise<void> | undefined;
  let fileError: unknown;
  let formError: ApiError | undefined;
  const rejectForm = (error: ApiError) => {
    if (formError) return;
    formError = error;
    // Let Busboy finish updating its current part before destroying it.
    queueMicrotask(() => parser.destroy(error));
  };
  parser.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated || fields.has(name)) {
      rejectForm(badRequest("invalid multipart field"));
    } else {
      fields.set(name, value);
    }
  });
  parser.on("file", (name, stream, info) => {
    // The callback may await authorization before consuming the bounded file
    // stream. Handle any parser error during that wait.
    stream.on("error", () => undefined);
    stream.once("limit", () => rejectForm(tooLarge));
    if (name !== "file") {
      stream.resume();
      return;
    }
    fileWork = receiveFile(stream, info, fields).then(
      (value) => { file = value; },
      (error: unknown) => {
        fileError = error;
        parser.destroy(error instanceof Error ? error : new Error("file receive failed"));
      },
    );
  });
  for (const event of ["partsLimit", "fieldsLimit", "filesLimit"]) {
    parser.once(event, () => rejectForm(badRequest("too many multipart parts")));
  }

  try {
    await pipeline(source, parser, { signal: req.signal });
  } catch (error) {
    await fileWork;
    if (formError) throw formError;
    if (error instanceof ApiError) throw error;
    if (req.signal.aborted || !fileError || /^(Unexpected end|Malformed part header)/.test(String((error as Error).message))) {
      throw badRequest("invalid or interrupted multipart form data");
    }
    throw fileError;
  }
  await fileWork;
  if (formError) throw formError;
  if (fileError) throw fileError;
  return { fields, file };
}
