import { badRequest } from "./api/errors";
export async function readLlmBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("入力が必要です");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 320000) { await reader.cancel(); throw badRequest("入力が上限を超えています"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw badRequest("入力の形式またはサイズが無効です"); }
  finally { reader.releaseLock(); }
}
