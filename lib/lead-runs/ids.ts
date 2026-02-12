export function buildLeadDocId(input: { source: string; id: string }): string {
  // Keep consistent with Firestore doc IDs used by /api/leads/source.
  return `${input.source}-${input.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export function buildLeadActionIdempotencyKey(input: {
  runId: string;
  leadDocId: string;
  action: string;
}): string {
  // Human-readable; server hashes to a fixed Firestore id.
  return `${input.runId}:${input.leadDocId}:${input.action}`;
}

