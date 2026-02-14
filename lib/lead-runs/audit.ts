export type AuditActionStatus = "complete" | "error" | "skipped" | "simulated";

export interface AuditActionReceipt {
  actionId?: string;
  status?: AuditActionStatus;
  dryRun?: boolean;
  replayed?: boolean;
  correlationId?: string;
  createdAt?: string;
  updatedAt?: string;
  data?: Record<string, unknown>;
}

export interface AuditLeadReceipt {
  leadDocId: string;
  companyName?: string;
  score?: number;
  actions?: AuditActionReceipt[];
}

export interface RunAuditEvent {
  leadDocId: string;
  companyName: string;
  score?: number;
  actionId: string;
  status?: AuditActionStatus;
  dryRun?: boolean;
  replayed?: boolean;
  correlationId?: string;
  createdAt?: string;
  updatedAt?: string;
  data?: Record<string, unknown>;
}

export function flattenRunAuditTimeline(leads: AuditLeadReceipt[]): RunAuditEvent[] {
  const events: RunAuditEvent[] = [];
  for (const lead of leads) {
    const companyName = lead.companyName || lead.leadDocId;
    for (const action of lead.actions || []) {
      events.push({
        leadDocId: lead.leadDocId,
        companyName,
        score: lead.score,
        actionId: action.actionId || "action",
        status: action.status,
        dryRun: action.dryRun,
        replayed: action.replayed,
        correlationId: action.correlationId,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt,
        data: action.data,
      });
    }
  }

  events.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return events;
}

export function pickAuditIds(data?: Record<string, unknown>): string[] {
  if (!data) return [];
  const keys = ["eventId", "messageId", "threadId", "folderId", "smsSid", "callSid", "sid", "id"];
  const ids: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      ids.push(`${key}:${value}`);
    }
  }
  return ids;
}

