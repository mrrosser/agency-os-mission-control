import { promises as fs } from "fs";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  escapeXml,
  extractVoiceKnowledgeContext,
  planVoiceTurn,
  resolveBusinessIdForCall,
  type VoiceKnowledgeContext,
  type VoiceActionName,
} from "@/lib/voice/inbound-webhook";
import { triggerVoiceActionsWorker } from "@/lib/voice/action-jobs";

const KNOWLEDGE_PACK_PATH = path.join(
  process.cwd(),
  "please-review",
  "from-root",
  "config-templates",
  "knowledge-pack.v2.json"
);

function safeCompare(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requestUrl(request: Request & { nextUrl?: URL }): URL {
  return request.nextUrl || new URL(request.url);
}

function buildActionUrl(requestUrl: URL): string {
  const actionUrl = new URL(requestUrl.pathname, requestUrl.origin);
  const token = requestUrl.searchParams.get("token");
  if (token) actionUrl.searchParams.set("token", token);
  return actionUrl.toString();
}

function buildTwimlResponse(args: {
  say: string;
  requestUrl: URL;
  keepGathering?: boolean;
}): NextResponse {
  const actionUrl = buildActionUrl(args.requestUrl);
  const say = escapeXml(args.say);
  const prompt = escapeXml(
    "What would you like me to do next? You can say schedule a meeting, draft an email, or ask a question."
  );

  const body = args.keepGathering === false
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${say}</Say></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${say}</Say><Gather input="speech" speechTimeout="auto" language="en-US" method="POST" action="${escapeXml(actionUrl)}"><Say>${prompt}</Say></Gather></Response>`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function parseForm(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const output: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      output[key] = value;
    }
    return output;
  }

  // Twilio sends urlencoded payloads, but keep a JSON fallback for local testability.
  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload || {})) {
      output[key] = typeof value === "string" ? value : String(value ?? "");
    }
    return output;
  }

  const searchParams = requestUrl(request).searchParams;
  const output: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    output[key] = value;
  }
  return output;
}

async function loadKnowledgeContext(log: { warn: (message: string, data?: Record<string, unknown>) => void }) {
  try {
    const raw = await fs.readFile(KNOWLEDGE_PACK_PATH, "utf8");
    const payload = JSON.parse(raw) as unknown;
    return extractVoiceKnowledgeContext(payload);
  } catch (error) {
    log.warn("twilio.voice_webhook.knowledge_pack_missing", {
      path: KNOWLEDGE_PACK_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
    return extractVoiceKnowledgeContext({});
  }
}

function actionId(args: { callSid: string; action: VoiceActionName; transcript: string }): string {
  const normalized = `${args.callSid}:${args.action}:${args.transcript.trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

async function enqueueVoiceAction(args: {
  action: VoiceActionName;
  mode: string;
  callSid: string;
  from: string;
  to: string;
  businessId: string | null;
  uid: string | null;
  transcript: string;
}) {
  const requestId = actionId({
    callSid: args.callSid,
    action: args.action,
    transcript: args.transcript,
  });

  await getAdminDb()
    .collection("voice_action_requests")
    .doc(requestId)
    .set(
      {
        requestId,
        source: "twilio.voice_webhook",
        status: "queued",
        action: args.action,
        mode: args.mode,
        callSid: args.callSid,
        from: args.from,
        to: args.to,
        businessId: args.businessId,
        uid: args.uid,
        transcript: args.transcript,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return requestId;
}

async function storeVoiceSession(args: {
  callSid: string;
  from: string;
  to: string;
  uid: string | null;
  transcript: string | null;
  responseText: string;
  businessId: string | null;
  queuedAction: VoiceActionName | null;
}) {
  await getAdminDb()
    .collection("voice_call_sessions")
    .doc(args.callSid)
    .set(
      {
        callSid: args.callSid,
        from: args.from,
        to: args.to,
        uid: args.uid,
        businessId: args.businessId,
        lastTranscript: args.transcript,
        lastResponse: args.responseText,
        lastQueuedAction: args.queuedAction,
        turnCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

function validateWebhookToken(requestUrl: URL) {
  const expected = (process.env.TWILIO_VOICE_WEBHOOK_TOKEN || "").trim();
  if (!expected) return;
  const provided = (requestUrl.searchParams.get("token") || "").trim();
  if (!provided || !safeCompare(expected, provided)) {
    throw new ApiError(401, "Unauthorized webhook token");
  }
}

function parseTranscript(form: Record<string, string>): string {
  const speech = (form.SpeechResult || "").trim();
  const digits = (form.Digits || "").trim();
  return speech || digits;
}

function greeting(context: VoiceKnowledgeContext, businessId: string | null): string {
  if (!context.policy.enabled) {
    return "Voice workflow is currently disabled. Please email us and we will follow up.";
  }
  const business = context.businesses.find((item) => item.id === businessId);
  if (business) {
    return `Thanks for calling ${business.name}. I can schedule a meeting, draft a follow up email, or answer basic questions.`;
  }
  return "Thanks for calling. I can schedule a meeting, draft a follow up email, or answer basic questions.";
}

function statusCompleted(form: Record<string, string>): boolean {
  const status = (form.CallStatus || "").trim().toLowerCase();
  return status === "completed" || status === "canceled" || status === "failed" || status === "busy";
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const reqUrl = requestUrl(request);
    validateWebhookToken(reqUrl);
    const form = await parseForm(request);
    const callSid = (form.CallSid || "").trim() || `call-${Date.now()}`;
    const from = (form.From || "").trim();
    const to = (form.To || "").trim();
    const uid = (reqUrl.searchParams.get("uid") || "").trim() || null;

    const context = await loadKnowledgeContext(log);
    const inferredBusinessId = resolveBusinessIdForCall(context, to, from);
    const transcript = parseTranscript(form);

    if (statusCompleted(form)) {
      log.info("twilio.voice_webhook.completed", {
        callSid,
        from,
        to,
        businessId: inferredBusinessId,
      });
      return buildTwimlResponse({
        say: "Thanks for calling. Goodbye.",
        requestUrl: reqUrl,
        keepGathering: false,
      });
    }

    if (!transcript) {
      const welcome = greeting(context, inferredBusinessId);
      await storeVoiceSession({
        callSid,
        from,
        to,
        uid,
        transcript: null,
        responseText: welcome,
        businessId: inferredBusinessId,
        queuedAction: null,
      });
      log.info("twilio.voice_webhook.greeting", {
        callSid,
        from,
        to,
        businessId: inferredBusinessId,
      });
      return buildTwimlResponse({
        say: welcome,
        requestUrl: reqUrl,
      });
    }

    const planned = planVoiceTurn({
      context,
      transcript,
      inferredBusinessId,
    });

    let queuedRequestId: string | null = null;
    let queueDispatch: "cloud_tasks" | "http" | "skipped" | null = null;
    if (planned.queuedAction) {
      queuedRequestId = await enqueueVoiceAction({
        action: planned.queuedAction.action,
        mode: planned.queuedAction.mode,
        callSid,
        from,
        to,
        businessId: planned.businessId,
        uid,
        transcript,
      });

      const workerToken = (process.env.VOICE_ACTIONS_WORKER_TOKEN || "").trim();
      if (!workerToken) {
        log.warn("twilio.voice_webhook.worker_token_missing", {
          callSid,
          queueRequestId: queuedRequestId,
        });
      } else {
        queueDispatch = await triggerVoiceActionsWorker({
          origin: reqUrl.origin,
          workerToken,
          correlationId,
          requestId: queuedRequestId,
          log,
        });
      }
    }

    await storeVoiceSession({
      callSid,
      from,
      to,
      uid,
      transcript,
      responseText: planned.responseText,
      businessId: planned.businessId,
      queuedAction: planned.queuedAction?.action || null,
    });

    log.info("twilio.voice_webhook.turn", {
      callSid,
      from,
      to,
      transcriptChars: transcript.length,
      uid,
      businessId: planned.businessId,
      action: planned.queuedAction?.action || null,
      queueRequestId: queuedRequestId,
      queueDispatch,
    });

    return buildTwimlResponse({
      say: planned.responseText,
      requestUrl: reqUrl,
    });
  },
  { route: "twilio.voice-webhook" }
);
