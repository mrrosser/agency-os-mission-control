const DEFAULT_MAX_STRING = 2000;

function clip(text: string, maxChars: number): string {
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function redactBearerTokens(text: string): string {
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [REDACTED]");
}

function redactQueryParams(text: string): string {
  // Best-effort redaction for common credential-like query params.
  return text.replace(
    /([?&](?:access_token|id_token|refresh_token|token|key|api_key|apikey|secret)=)([^&\s]+)/gi,
    "$1[REDACTED]"
  );
}

function redactKnownKeyPatterns(text: string): string {
  return (
    text
      // OpenAI/Heygen-style secret keys
      .replace(/\bsk_[A-Za-z0-9]{10,}\b/g, "sk_[REDACTED]")
      // Google API keys
      .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]")
      // Generic long hex tokens
      .replace(/\b[a-f0-9]{32,}\b/gi, "[REDACTED_HEX]")
  );
}

export function redactSecrets(text: string): string {
  return redactKnownKeyPatterns(redactQueryParams(redactBearerTokens(text)));
}

export function sanitizeTelemetryString(
  value: unknown,
  maxChars: number = DEFAULT_MAX_STRING
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return clip(redactSecrets(trimmed), maxChars);
}

function sanitizeUnknown(
  value: unknown,
  options: {
    maxDepth: number;
    maxKeys: number;
    maxArray: number;
    maxString: number;
  },
  depth: number
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return sanitizeTelemetryString(value, options.maxString);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (depth >= options.maxDepth) return "[TRUNCATED_DEPTH]";
    return value
      .slice(0, options.maxArray)
      .map((item) => sanitizeUnknown(item, options, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= options.maxDepth) return "[TRUNCATED_DEPTH]";
    const entries = Object.entries(value as Record<string, unknown>).slice(0, options.maxKeys);
    const next: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      // Always redact values for keys that likely contain secrets.
      if (/(token|secret|password|authorization|api.?key)/i.test(key)) {
        next[key] = "[REDACTED]";
        continue;
      }
      next[key] = sanitizeUnknown(val, options, depth + 1);
    }
    return next;
  }

  return String(value);
}

export function sanitizeTelemetryMeta(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const cleaned = sanitizeUnknown(
    value,
    { maxDepth: 4, maxKeys: 40, maxArray: 20, maxString: 1000 },
    0
  );
  return (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : undefined);
}

