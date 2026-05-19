import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  PaperclipClient,
  PaperclipClientError,
  readPaperclipClientConfig,
  type PaperclipLifecycleAction,
} from "@/lib/paperclip/client";

const actionSchema = z
  .object({
    agentId: z.string().trim().min(1).max(80),
    action: z.enum(["pause", "ping", "route", "resume", "terminate", "wakeup"]),
    target: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(400).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "route" && !value.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "target is required for route actions",
      });
    }
  });

function parseAllowedUids(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
}

function readBooleanEnv(name: string, fallback: boolean = false): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isPaperclipLifecycleAction(action: z.infer<typeof actionSchema>["action"]): action is PaperclipLifecycleAction {
  return action === "resume" || action === "terminate" || action === "wakeup";
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await request.json().catch(() => ({}));
    const parsed = actionSchema.safeParse(body || {});
    if (!parsed.success) {
      throw new ApiError(400, "Invalid payload", { issues: parsed.error.issues });
    }

    const allowedUids = parseAllowedUids(process.env.AGENT_ACTION_ALLOWED_UIDS);
    if (allowedUids.size > 0 && !allowedUids.has(user.uid)) {
      throw new ApiError(403, "Forbidden");
    }

    const payload = parsed.data;
    const idempotencyKey = getIdempotencyKey(request, payload);
    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "agents.actions.post",
        key: idempotencyKey,
        log,
      },
      async () => {
        const nowIso = new Date().toISOString();
        const requestId = randomUUID();

        if (isPaperclipLifecycleAction(payload.action)) {
          if (readBooleanEnv("MISSION_CONTROL_GLOBAL_KILL_SWITCH")) {
            throw new ApiError(423, "Mission Control global kill switch is enabled");
          }

          const config = readPaperclipClientConfig();
          if (!config) {
            throw new ApiError(503, "Paperclip proxy is not configured");
          }

          const client = new PaperclipClient(config);
          try {
            const proxied = await client.invokeLifecycleAction({
              agentId: payload.agentId,
              action: payload.action,
              correlationId,
              requestedByUid: user.uid,
              note: payload.note || null,
              target: payload.target || null,
              evidenceRef: `mission-control:${user.uid}`,
              autonomyClass: "internal_write",
            });

            log.info("agents.action.paperclip_forwarded", {
              uid: user.uid,
              agentId: payload.agentId,
              action: payload.action,
              requestId,
              status: proxied.status,
            });

            return {
              ok: true,
              requestId,
              status: "forwarded" as const,
              agentId: payload.agentId,
              action: payload.action,
              target: payload.target || null,
              proxied: true,
            };
          } catch (error) {
            if (error instanceof PaperclipClientError) {
              throw new ApiError(error.status, error.message);
            }
            throw error;
          }
        }

        await getAdminDb()
          .collection("agentActionRequests")
          .doc(requestId)
          .set({
            requestId,
            uid: user.uid,
            agentId: payload.agentId,
            action: payload.action,
            target: payload.target || null,
            note: payload.note || null,
            status: "queued",
            createdAt: nowIso,
            updatedAt: nowIso,
            correlationId,
          });

        log.info("agents.action.queued", {
          uid: user.uid,
          agentId: payload.agentId,
          action: payload.action,
          hasTarget: Boolean(payload.target),
          requestId,
        });

        return {
          ok: true,
          requestId,
          status: "queued" as const,
          agentId: payload.agentId,
          action: payload.action,
          target: payload.target || null,
        };
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "agents.actions.post" }
);
