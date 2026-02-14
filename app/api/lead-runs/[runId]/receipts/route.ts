import { NextResponse } from "next/server";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { assertLeadRunOwner } from "@/lib/lead-runs/receipts";

function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      try {
        return maybeTimestamp.toDate().toISOString();
      } catch {
        // fall through to object mapping
      }
    }

    if (Array.isArray(value)) {
      return value.map((v) => toSerializable(v));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toSerializable(v);
    }
    return out;
  }

  return value;
}

export const GET = withApiHandler(
  async ({ request, params, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const runId = params?.runId;
    if (!runId) throw new ApiError(400, "Missing runId");

    await assertLeadRunOwner(runId, user.uid, log);

    const runRef = getAdminDb().collection("lead_runs").doc(runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new ApiError(404, "Lead run not found");
    }

    const runData = runSnap.data() || {};
    const serializedRun = toSerializable(runData);
    const runObject =
      serializedRun && typeof serializedRun === "object" && !Array.isArray(serializedRun)
        ? (serializedRun as Record<string, unknown>)
        : {};
    const leadsSnap = await runRef.collection("leads").get();

    const leads = await Promise.all(
      leadsSnap.docs.map(async (leadDoc) => {
        const serializedLead = toSerializable(leadDoc.data());
        const leadData =
          serializedLead && typeof serializedLead === "object" && !Array.isArray(serializedLead)
            ? (serializedLead as Record<string, unknown>)
            : {};

        const actionsSnap = await leadDoc.ref.collection("actions").get();
        const actions = actionsSnap.docs
          .map((actionDoc) => toSerializable(actionDoc.data()))
          .sort((a, b) => {
            const aStr = String((a as { updatedAt?: string })?.updatedAt || "");
            const bStr = String((b as { updatedAt?: string })?.updatedAt || "");
            return bStr.localeCompare(aStr);
          });

        return {
          leadDocId: leadDoc.id,
          ...leadData,
          actions,
        };
      })
    );

    leads.sort((a, b) => {
      const scoreA = Number((a as { score?: number })?.score || 0);
      const scoreB = Number((b as { score?: number })?.score || 0);
      return scoreB - scoreA;
    });

    return NextResponse.json({
      run: {
        runId,
        ...runObject,
      },
      leads,
    });
  },
  { route: "lead-runs.receipts.get" }
);
