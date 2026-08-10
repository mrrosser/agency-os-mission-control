import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { forwardApplicationDeskRequest } from "@/lib/application-desk-proxy";
import { PREPARED_APPLICATION_WORKSPACE_ID } from "@/lib/application-desk";

export const dynamic = "force-dynamic";

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    await requireFirebaseAuth(request, log);
    if (request.headers.get("x-workspace-id")?.trim() !== PREPARED_APPLICATION_WORKSPACE_ID) {
      throw new ApiError(403, "Prepared applications are available only in the Marcus Artist workspace.");
    }
    return forwardApplicationDeskRequest({
      request,
      path: "/api/artist-manager/application-reviews/import-prepared",
      method: "POST",
      correlationId,
      log,
      maxRequestBytes: 256,
      requireWorkspace: true,
    });
  },
  { route: "application-desk.import-prepared" },
);
