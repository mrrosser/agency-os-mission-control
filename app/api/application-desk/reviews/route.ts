import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { forwardApplicationDeskRequest } from "@/lib/application-desk-proxy";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    await requireFirebaseAuth(request, log);
    return forwardApplicationDeskRequest({
      request,
      path: "/api/artist-manager/application-reviews",
      method: "GET",
      correlationId,
      log,
      requireWorkspace: true,
    });
  },
  { route: "application-desk.reviews" },
);
