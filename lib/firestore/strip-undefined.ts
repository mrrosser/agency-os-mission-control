import "server-only";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deeply removes `undefined` values from plain objects/arrays while preserving
 * non-plain objects (e.g., Firestore FieldValue transforms).
 */
export function stripUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = stripUndefined(val);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }

  // Preserve non-plain objects (Dates, Buffers, Firestore FieldValue, etc.).
  return value;
}

