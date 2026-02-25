import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { decideSocialDraftWithToken } from "@/lib/social/drafts";

const querySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  token: z.string().trim().min(20).max(300),
  decision: z.enum(["approve", "reject"]),
  source: z.string().trim().min(1).max(80).optional(),
});

function renderDecisionHtml(args: {
  draftId: string;
  status: string;
  decision: "approve" | "reject";
  replayed: boolean;
  correlationId: string;
}): string {
  const headline =
    args.decision === "approve"
      ? "Draft approved successfully."
      : "Draft rejected successfully.";
  const subline = args.replayed
    ? "This decision was already applied earlier."
    : "Decision has been recorded for your agent workflow.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Social Draft Decision</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6edf3;margin:0;padding:2rem}
      .card{max-width:680px;margin:0 auto;border:1px solid #2b3240;border-radius:14px;padding:1.2rem;background:#171b23}
      h1{margin:0 0 .5rem;font-size:1.2rem}
      p{margin:.35rem 0;color:#c0cad8}
      code{background:#0f1115;padding:.08rem .35rem;border-radius:6px}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${headline}</h1>
      <p>${subline}</p>
      <p>Status: <code>${args.status}</code></p>
      <p>Draft ID: <code>${args.draftId}</code></p>
      <p>Correlation ID: <code>${args.correlationId}</code></p>
    </div>
  </body>
</html>`;
}

function wantsJson(request: Request): boolean {
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return accept.includes("application/json");
}

export const GET = withApiHandler(
  async ({ request, params, log, correlationId }) => {
    const draftId = String(params?.draftId || "").trim();
    const requestUrl = request.nextUrl || new URL(request.url);
    const parsed = querySchema.parse({
      uid: requestUrl.searchParams.get("uid"),
      token: requestUrl.searchParams.get("token"),
      decision: requestUrl.searchParams.get("decision"),
      source: requestUrl.searchParams.get("source") ?? undefined,
    });

    const result = await decideSocialDraftWithToken({
      uid: parsed.uid,
      draftId,
      token: parsed.token,
      decision: parsed.decision,
      source: parsed.source || "google_space_link",
      log,
      correlationId,
    });

    if (wantsJson(request)) {
      return NextResponse.json({
        ok: true,
        ...result,
        correlationId,
      });
    }

    return new NextResponse(
      renderDecisionHtml({
        draftId: result.draftId,
        status: result.status,
        decision: result.decision,
        replayed: result.replayed,
        correlationId,
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-correlation-id": correlationId,
        },
      }
    );
  },
  { route: "social.drafts.decision.get" }
);
