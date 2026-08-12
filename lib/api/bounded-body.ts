import { ApiError } from "@/lib/api/handler";

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new ApiError(500, "Invalid request body limit.");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new ApiError(400, "Invalid Content-Length.");
    if (Number(declared) > maxBytes) {
      throw new ApiError(413, "Request body is too large.");
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request_body_too_large");
        throw new ApiError(413, "Request body is too large.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(400, "Request body must be valid UTF-8.");
  }
}
