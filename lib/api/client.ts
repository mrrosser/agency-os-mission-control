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
