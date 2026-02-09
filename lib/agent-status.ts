import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";

export interface AgentSpaceStatus {
  agentId: string;
  updatedAt?: string | null;
  source?: string | null;
  messageId?: string | null;
}

interface StoredSpaceStatus {
  agentId?: string;
  updatedAt?: unknown;
  source?: string | null;
  messageId?: string | null;
}

const COLLECTION = "agent_status";

function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const toDate = obj.toDate;
    if (typeof toDate === "function") {
      const date = toDate.call(value) as Date;
      return date.toISOString();
    }

    const seconds = obj.seconds;
    if (typeof seconds === "number") {
      return new Date(seconds * 1000).toISOString();
    }
  }

  return null;
}

function serializeSpaces(spaces?: Record<string, StoredSpaceStatus>): Record<string, AgentSpaceStatus> {
  if (!spaces) return {};
  const output: Record<string, AgentSpaceStatus> = {};
  for (const [spaceId, status] of Object.entries(spaces)) {
    if (!status?.agentId) continue;
    output[spaceId] = {
      agentId: status.agentId,
      source: status.source ?? null,
      messageId: status.messageId ?? null,
      updatedAt: serializeTimestamp(status.updatedAt),
    };
  }
  return output;
}

export async function getAgentSpaceStatus(
  uid: string,
  log?: Logger
): Promise<Record<string, AgentSpaceStatus>> {
  log?.info("agent.status.read", { uid });
  const doc = await getAdminDb().collection(COLLECTION).doc(uid).get();
  const data = doc.data() as { spaces?: Record<string, StoredSpaceStatus> } | undefined;
  return serializeSpaces(data?.spaces);
}

export async function setAgentSpaceStatus(
  uid: string,
  spaceId: string,
  agentId: string,
  source?: string,
  messageId?: string,
  log?: Logger
): Promise<void> {
  log?.info("agent.status.update", { uid, spaceId, agentId, source, messageId });
  await getAdminDb()
    .collection(COLLECTION)
    .doc(uid)
    .set(
      {
        spaces: {
          [spaceId]: {
            agentId,
            source: source || null,
            messageId: messageId || null,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    );
}
