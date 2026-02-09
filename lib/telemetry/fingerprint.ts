import { createHash } from "crypto";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d{2,}\b/g, "<num>")
    .replace(/\b[a-f0-9]{16,}\b/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim();
}

function stackTop(stack: string | undefined, lines: number): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .slice(0, lines)
    .map((line) => normalize(line))
    .join("\n");
}

export function computeTelemetryFingerprint(input: {
  kind: string;
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  url?: string;
}): string {
  const basis = [
    normalize(input.kind),
    normalize(input.name || ""),
    normalize(input.message),
    stackTop(input.stack, 6),
    normalize(input.route || ""),
    normalize(input.url || ""),
  ].join("|");

  return createHash("sha256").update(basis).digest("hex");
}

