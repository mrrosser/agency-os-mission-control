import { promises as fs } from "fs";
import path from "path";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { extractVoiceKnowledgeContext } from "@/lib/voice/inbound-webhook";
import { processQueuedVoiceActions } from "@/lib/voice/action-worker";

const KNOWLEDGE_PACK_PATH = path.join(
  process.cwd(),
  "please-review",
  "from-root",
  "config-templates",
  "knowledge-pack.v2.json"
);

const bodySchema = z.object({
  workerToken: z.string().trim().min(1).max(200),
  maxTasks: z.number().int().min(1).max(25).optional(),
  dryRun: z.boolean().optional(),
});

function safeCompare(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function loadVoiceContext(log: { warn: (message: string, data?: Record<string, unknown>) => void }) {
  try {
    const raw = await fs.readFile(KNOWLEDGE_PACK_PATH, "utf8");
    return extractVoiceKnowledgeContext(JSON.parse(raw) as unknown);
  } catch (error) {
    log.warn("voice.actions.knowledge_pack_missing", {
      path: KNOWLEDGE_PACK_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
    return extractVoiceKnowledgeContext({});
  }
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const expectedToken = (process.env.VOICE_ACTIONS_WORKER_TOKEN || "").trim();
    if (!expectedToken) {
      throw new ApiError(500, "Missing VOICE_ACTIONS_WORKER_TOKEN");
    }

    const body = await parseJson(request, bodySchema);
    if (!safeCompare(expectedToken, body.workerToken.trim())) {
      throw new ApiError(403, "Forbidden");
    }

    const context = await loadVoiceContext(log);
    const maxTasks = body.maxTasks ?? 10;
    const dryRun = body.dryRun ?? false;

    const result = await processQueuedVoiceActions({
      context,
      log,
      correlationId,
      maxTasks,
      dryRun,
    });

    log.info("voice.actions.worker.completed", {
      ...result,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  },
  { route: "twilio.voice-actions.worker-task" }
);
