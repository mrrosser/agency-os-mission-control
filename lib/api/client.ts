import type { User } from "firebase/auth";

interface AuthHeaderOptions {
  idempotencyKey?: string;
  correlationId?: string;
}

export async function buildAuthHeaders(
  user: User | null,
  options: AuthHeaderOptions = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Correlation-Id": options.correlationId || crypto.randomUUID(),
  };

  if (options.idempotencyKey) {
    headers["X-Idempotency-Key"] = options.idempotencyKey;
  }

  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function getResponseCorrelationId(response: Response): string | null {
  return response.headers.get("x-correlation-id");
}

function getContentType(response: Response): string {
  return response.headers.get("content-type") || "";
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function oneLineSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

/**
 * Read an API response as JSON, emitting a helpful error if the backend returns HTML
 * (e.g. Cloud Run 502/503 pages) instead of JSON.
 */
export async function readApiJson<T = unknown>(response: Response): Promise<T> {
  const raw = await response.text();
  const contentType = getContentType(response);

  if (!raw) {
    throw new Error(`Empty response body (status ${response.status})`);
  }

  if (!isJsonContentType(contentType)) {
    const cid = getResponseCorrelationId(response);
    const snippet = oneLineSnippet(raw, 200);
    throw new Error(
      `Expected JSON but got ${contentType || "unknown"} (status ${response.status})` +
        (cid ? ` cid=${cid}` : "") +
        (snippet ? ` body="${snippet}"` : "")
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const cid = getResponseCorrelationId(response);
    const snippet = oneLineSnippet(raw, 200);
    throw new Error(
      `Invalid JSON (status ${response.status})` +
        (cid ? ` cid=${cid}` : "") +
        (snippet ? ` body="${snippet}"` : "")
    );
  }
}
