import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getClientAutofixRun } from "@/lib/client-autofix";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log, params }) => {
    const user = await requireFirebaseAuth(request, log);
    const runId = params?.runId?.trim();
    if (!runId) {
      throw new ApiError(400, "runId is required");
    }

    const run = await getClientAutofixRun(runId);
    if (!run) {
      throw new ApiError(404, "Client autofix run not found");
    }

    log.info("agents.client_autofix.status", {
      uid: user.uid,
      runId,
      status: run.status,
      projectId: run.project_id,
      clientId: run.client_id,
    });

    return NextResponse.json({
      status: "ok",
      run,
    });
  },
  { route: "agents.client-autofix.run.get" }
);
