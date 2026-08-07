export const OPERATIONS_POLL_INTERVAL_MS = 8_000;

export interface LeadRunPollSnapshot {
  runId: string;
  status: string;
  nextIndex: number;
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed"]);

export function isTerminalLeadRunStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status.trim().toLowerCase());
}

export function shouldRefreshRunReceipts(
  previous: LeadRunPollSnapshot | null,
  next: LeadRunPollSnapshot
): boolean {
  if (!previous || previous.runId !== next.runId) return true;
  if (previous.nextIndex !== next.nextIndex) return true;
  if (previous.status !== next.status) return true;
  return false;
}
