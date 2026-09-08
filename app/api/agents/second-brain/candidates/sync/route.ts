import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { syncSecondBrainCandidates } from "@/lib/second-brain";
import { SecondBrainCandidateSyncRequestSchema } from "@/lib/second-brain-contract";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSecondBrainService({ request, log, route: "agents.second-brain.candidates.sync" });
    const body = await parseJson(request, SecondBrainCandidateSyncRequestSchema);
    const operatorUid = assertSecondBrainOperatorUid(body.uid);
    const stableKey = createHash("sha256")
      .update(`${operatorUid}:${body.generatedAt}:${body.candidates.map((candidate) => candidate.candidateHash).join(":")}`)
      .digest("hex");
    const result = await withIdempotency(
      {
        uid: operatorUid,
        route: "agents.second-brain.candidates.sync",
        key: getIdempotencyKey(request, body) || stableKey,
        log,
      },
      () => syncSecondBrainCandidates({ ...body, uid: operatorUid }, { correlationId })
    );
    log.info("second_brain.candidates.synced", {
      uid: operatorUid,
      syncedCount: result.data.syncedCount,
      preservedTerminalCount: result.data.preservedTerminalCount,
      replayed: result.replayed,
    });
    return NextResponse.json({ ok: true, ...result.data, replayed: result.replayed, correlationId });
  },
  { route: "agents.second-brain.candidates.sync" }
);
