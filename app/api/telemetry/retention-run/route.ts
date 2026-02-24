import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const requestSchema = z.object({
  dryRun: z.boolean().optional(),
  eventRetentionDays: z.number().int().min(1).max(3650).optional(),
  groupRetentionDays: z.number().int().min(1).max(3650).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
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

function resolveGithubRepo(): { owner: string; repo: string } {
  const owner = (process.env.GITHUB_WORKFLOW_OWNER || "").trim();
  const repo = (process.env.GITHUB_WORKFLOW_REPO || "").trim();
  if (owner && repo) return { owner, repo };

  const fromRepository = (process.env.GITHUB_REPOSITORY || "").trim();
  const [derivedOwner, derivedRepo] = fromRepository.split("/", 2);
  if (derivedOwner && derivedRepo) {
    return { owner: derivedOwner, repo: derivedRepo };
  }

  throw new ApiError(503, "Telemetry cleanup dispatch is not configured (missing GitHub owner/repo).");
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await request.json().catch(() => ({}));
    const parsed = requestSchema.safeParse(body || {});
    if (!parsed.success) {
      throw new ApiError(400, "Invalid payload", { issues: parsed.error.issues });
    }

    const allowedUids = parseAllowedUids(process.env.TELEMETRY_CLEANUP_ALLOWED_UIDS);
    if (allowedUids.size > 0 && !allowedUids.has(user.uid)) {
      throw new ApiError(403, "Forbidden");
    }

    const workflowToken = (process.env.GITHUB_WORKFLOW_DISPATCH_TOKEN || "").trim();
    if (!workflowToken) {
      throw new ApiError(503, "Telemetry cleanup dispatch token is not configured.");
    }

    const dryRun = parsed.data.dryRun ?? true;
    const eventRetentionDays = parsed.data.eventRetentionDays ?? 30;
    const groupRetentionDays = parsed.data.groupRetentionDays ?? 180;

    if (groupRetentionDays < eventRetentionDays) {
      throw new ApiError(400, "groupRetentionDays must be >= eventRetentionDays");
    }

    const { owner, repo } = resolveGithubRepo();
    const workflowFile =
      (process.env.GITHUB_TELEMETRY_RETENTION_WORKFLOW || "telemetry-retention-cleanup.yml").trim();
    const workflowRef = (process.env.GITHUB_TELEMETRY_RETENTION_REF || "main").trim();
    const runUrl = `https://github.com/${owner}/${repo}/actions/workflows/${workflowFile}`;

    const key = getIdempotencyKey(request, parsed.data);
    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "telemetry.retention_run.post",
        key,
        log,
      },
      async () => {
        const dispatchRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
            workflowFile
          )}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${workflowToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
              "User-Agent": "telemetry-retention-dispatch",
              "X-Correlation-Id": correlationId,
            },
            body: JSON.stringify({
              ref: workflowRef,
              inputs: {
                dry_run: String(dryRun),
                event_retention_days: String(eventRetentionDays),
                group_retention_days: String(groupRetentionDays),
              },
            }),
          }
        );

        if (!dispatchRes.ok) {
          const raw = await dispatchRes.text().catch(() => "");
          throw new ApiError(502, "GitHub workflow dispatch failed", {
            status: dispatchRes.status,
            body: raw.slice(0, 1000),
          });
        }

        return {
          ok: true,
          dispatchRequested: true,
          workflowFile,
          workflowRef,
          runUrl,
          dryRun,
          eventRetentionDays,
          groupRetentionDays,
        };
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "telemetry.retention_run.post" }
);
