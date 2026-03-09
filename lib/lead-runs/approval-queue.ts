import { getAdminDb } from "@/lib/firebase-admin";

export const EMAIL_APPROVAL_ACTION_IDS = ["gmail.outreach_draft", "gmail.availability_draft"] as const;
export const CALENDAR_APPROVAL_ACTION_IDS = ["calendar.booking"] as const;

type ApprovalActionId =
  | (typeof EMAIL_APPROVAL_ACTION_IDS)[number]
  | (typeof CALENDAR_APPROVAL_ACTION_IDS)[number];

type ApprovalActionStatus = "complete" | "error" | "skipped" | "simulated";

export interface ApprovalQueueActionRecord {
  key: string;
  leadPath: string;
  runId: string;
  leadDocId: string;
  actionId: string;
  status?: ApprovalActionStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  data?: Record<string, unknown>;
}

export interface ApprovalQueueLeadRecord {
  leadDocId: string;
  companyName?: string;
  founderName?: string;
  email?: string;
  website?: string;
  location?: string;
}

interface ApprovalQueueBaseItem {
  key: string;
  runId: string;
  leadDocId: string;
  companyName: string;
  founderName: string | null;
  leadEmail: string | null;
  website: string | null;
  location: string | null;
  status: ApprovalActionStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EmailApprovalQueueItem extends ApprovalQueueBaseItem {
  kind: "email";
  actionId: (typeof EMAIL_APPROVAL_ACTION_IDS)[number];
  queueLabel: "Outreach Draft" | "Availability Follow-up";
  subject: string | null;
  recipients: string[];
  draftId: string | null;
  messageId: string | null;
  threadId: string | null;
}

export interface CalendarApprovalQueueItem extends ApprovalQueueBaseItem {
  kind: "calendar";
  actionId: (typeof CALENDAR_APPROVAL_ACTION_IDS)[number];
  queueLabel: "Scheduled Meeting";
  summary: string | null;
  attendees: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  eventId: string | null;
  htmlLink: string | null;
  meetLink: string | null;
}

export interface ApprovalQueueSnapshot {
  email: EmailApprovalQueueItem[];
  calendar: CalendarApprovalQueueItem[];
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      try {
        return candidate.toDate().toISOString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isApprovalStatus(status: string | undefined): status is ApprovalActionStatus {
  return status === "complete" || status === "simulated" || status === "skipped" || status === "error";
}

function leadDefaults(lead: ApprovalQueueLeadRecord | undefined, leadDocId: string) {
  return {
    companyName: String(lead?.companyName || "Lead"),
    founderName: lead?.founderName ? String(lead.founderName) : null,
    leadEmail: lead?.email ? String(lead.email) : null,
    website: lead?.website ? String(lead.website) : null,
    location: lead?.location ? String(lead.location) : null,
    leadDocId,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

export function buildApprovalQueueSnapshot(
  actions: ApprovalQueueActionRecord[],
  leadByPath: Record<string, ApprovalQueueLeadRecord>,
  options?: { emailLimit?: number; calendarLimit?: number }
): ApprovalQueueSnapshot {
  const emailLimit = options?.emailLimit ?? 20;
  const calendarLimit = options?.calendarLimit ?? 20;

  const email = actions
    .filter((action): action is ApprovalQueueActionRecord & { actionId: (typeof EMAIL_APPROVAL_ACTION_IDS)[number] } =>
      EMAIL_APPROVAL_ACTION_IDS.includes(action.actionId as (typeof EMAIL_APPROVAL_ACTION_IDS)[number])
    )
    .filter((action) => (action.status === "complete" || action.status === "simulated") && action.data)
    .sort((a, b) => timeValue(b.updatedAt || b.createdAt) - timeValue(a.updatedAt || a.createdAt))
    .slice(0, emailLimit)
    .map((action) => {
      const lead = leadDefaults(leadByPath[action.leadPath], action.leadDocId);
      return {
        kind: "email" as const,
        key: action.key,
        runId: action.runId,
        leadDocId: action.leadDocId,
        companyName: lead.companyName,
        founderName: lead.founderName,
        leadEmail: lead.leadEmail,
        website: lead.website,
        location: lead.location,
        status: action.status || "complete",
        createdAt: action.createdAt || null,
        updatedAt: action.updatedAt || null,
        actionId: action.actionId,
        queueLabel:
          action.actionId === "gmail.availability_draft"
            ? ("Availability Follow-up" as const)
            : ("Outreach Draft" as const),
        subject: typeof action.data?.subject === "string" ? action.data.subject : null,
        recipients: asStringArray(action.data?.to),
        draftId: typeof action.data?.draftId === "string" ? action.data.draftId : null,
        messageId: typeof action.data?.messageId === "string" ? action.data.messageId : null,
        threadId: typeof action.data?.threadId === "string" ? action.data.threadId : null,
      };
    });

  const calendar = actions
    .filter(
      (action): action is ApprovalQueueActionRecord & { actionId: (typeof CALENDAR_APPROVAL_ACTION_IDS)[number] } =>
        CALENDAR_APPROVAL_ACTION_IDS.includes(action.actionId as (typeof CALENDAR_APPROVAL_ACTION_IDS)[number])
    )
    .filter((action) => (action.status === "complete" || action.status === "simulated") && action.data)
    .sort((a, b) => timeValue(b.updatedAt || b.createdAt) - timeValue(a.updatedAt || a.createdAt))
    .slice(0, calendarLimit)
    .map((action) => {
      const lead = leadDefaults(leadByPath[action.leadPath], action.leadDocId);
      return {
        kind: "calendar" as const,
        key: action.key,
        runId: action.runId,
        leadDocId: action.leadDocId,
        companyName: lead.companyName,
        founderName: lead.founderName,
        leadEmail: lead.leadEmail,
        website: lead.website,
        location: lead.location,
        status: action.status || "complete",
        createdAt: action.createdAt || null,
        updatedAt: action.updatedAt || null,
        actionId: action.actionId,
        queueLabel: "Scheduled Meeting" as const,
        summary: typeof action.data?.summary === "string" ? action.data.summary : null,
        attendees: asStringArray(action.data?.attendees),
        scheduledStart: typeof action.data?.scheduledStart === "string" ? action.data.scheduledStart : null,
        scheduledEnd: typeof action.data?.scheduledEnd === "string" ? action.data.scheduledEnd : null,
        eventId: typeof action.data?.eventId === "string" ? action.data.eventId : null,
        htmlLink: typeof action.data?.htmlLink === "string" ? action.data.htmlLink : null,
        meetLink: typeof action.data?.meetLink === "string" ? action.data.meetLink : null,
      };
    });

  return { email, calendar };
}

export async function listApprovalQueueForUser(
  uid: string,
  options?: { emailLimit?: number; calendarLimit?: number }
): Promise<ApprovalQueueSnapshot> {
  const actionsSnap = await getAdminDb().collectionGroup("actions").where("userId", "==", uid).get();

  const rawActions: ApprovalQueueActionRecord[] = [];
  const leadPaths = new Set<string>();

  for (const doc of actionsSnap.docs) {
    const parentLeadRef = doc.ref.parent.parent;
    const runRef = parentLeadRef?.parent.parent;
    if (!parentLeadRef || !runRef) continue;

    const data = doc.data() as {
      actionId?: string;
      status?: string;
      createdAt?: unknown;
      updatedAt?: unknown;
      data?: Record<string, unknown>;
    };

    const actionId = String(data.actionId || "") as ApprovalActionId;
    if (!EMAIL_APPROVAL_ACTION_IDS.includes(actionId as (typeof EMAIL_APPROVAL_ACTION_IDS)[number]) &&
        !CALENDAR_APPROVAL_ACTION_IDS.includes(actionId as (typeof CALENDAR_APPROVAL_ACTION_IDS)[number])) {
      continue;
    }

    rawActions.push({
      key: doc.ref.path,
      leadPath: parentLeadRef.path,
      runId: runRef.id,
      leadDocId: parentLeadRef.id,
      actionId,
      status: isApprovalStatus(data.status) ? data.status : undefined,
      createdAt: toIso(data.createdAt),
      updatedAt: toIso(data.updatedAt),
      data: data.data || {},
    });
    leadPaths.add(parentLeadRef.path);
  }

  const leadByPath: Record<string, ApprovalQueueLeadRecord> = {};
  await Promise.all(
    Array.from(leadPaths).map(async (leadPath) => {
      const leadSnap = await getAdminDb().doc(leadPath).get();
      if (!leadSnap.exists) return;
      const data = leadSnap.data() as ApprovalQueueLeadRecord;
      leadByPath[leadPath] = {
        leadDocId: leadSnap.id,
        companyName: typeof data.companyName === "string" ? data.companyName : undefined,
        founderName: typeof data.founderName === "string" ? data.founderName : undefined,
        email: typeof data.email === "string" ? data.email : undefined,
        website: typeof data.website === "string" ? data.website : undefined,
        location: typeof data.location === "string" ? data.location : undefined,
      };
    })
  );

  return buildApprovalQueueSnapshot(rawActions, leadByPath, options);
}
