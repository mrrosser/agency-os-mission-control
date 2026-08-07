import "server-only";

import { createHash, timingSafeEqual } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";

const googleOidcClient = new OAuth2Client();
const GOOGLE_OIDC_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export type RevenueAutomationWorkerAuthMode = "oidc" | "legacy_token";

export interface RevenueAutomationWorkerAuthResult {
  mode: RevenueAutomationWorkerAuthMode;
  principalHash: string;
}

export function resolveRevenueAutomationWorkerUid(requestedUid?: string): string {
  const configuredUid = asString(process.env.REVENUE_AUTOMATION_UID);
  if (!configuredUid) {
    throw new ApiError(503, "REVENUE_AUTOMATION_UID is not configured.");
  }
  const requested = asString(requestedUid);
  if (requested && requested !== configuredUid) {
    throw new ApiError(400, "Worker uid must match the configured revenue automation identity.");
  }
  return configuredUid;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseExplicitBoolean(value: unknown): boolean {
  return asString(value).toLowerCase() === "true";
}

function readBearerToken(request: Request): string {
  const authorization = asString(request.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function readLegacyWorkerTokens(): string[] {
  const candidates = [
    process.env.REVENUE_AUTOMATION_LEGACY_WORKER_TOKEN,
    process.env.REVENUE_DAY30_WORKER_TOKEN,
    process.env.REVENUE_DAY2_WORKER_TOKEN,
    process.env.REVENUE_DAY1_WORKER_TOKEN,
    process.env.REVENUE_POS_WORKER_TOKEN,
    process.env.REVENUE_WEEKLY_KPI_WORKER_TOKEN,
  ];
  return Array.from(new Set(candidates.map(asString).filter(Boolean)));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function principalHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function readOidcConfiguration(): {
  serviceAccountEmail: string;
  audience: string;
  configured: boolean;
} {
  const serviceAccountEmail = asString(
    process.env.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL
  ).toLowerCase();
  const audience = asString(process.env.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE);

  if (Boolean(serviceAccountEmail) !== Boolean(audience)) {
    throw new ApiError(
      503,
      "Incomplete revenue worker OIDC configuration. Set both the scheduler service account and audience."
    );
  }

  if (!serviceAccountEmail) {
    return { serviceAccountEmail: "", audience: "", configured: false };
  }

  if (!/^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
    throw new ApiError(503, "Invalid revenue worker scheduler service account configuration.");
  }

  let parsedAudience: URL;
  try {
    parsedAudience = new URL(audience);
  } catch {
    throw new ApiError(503, "Invalid revenue worker OIDC audience configuration.");
  }
  if (
    parsedAudience.protocol !== "https:" ||
    parsedAudience.username ||
    parsedAudience.password ||
    !parsedAudience.hostname.toLowerCase().endsWith(".run.app") ||
    parsedAudience.search ||
    parsedAudience.hash ||
    (parsedAudience.pathname !== "" && parsedAudience.pathname !== "/")
  ) {
    throw new ApiError(503, "Revenue worker OIDC audience must be an exact HTTPS service origin.");
  }

  return {
    serviceAccountEmail,
    audience,
    configured: true,
  };
}

async function verifySchedulerOidc(args: {
  token: string;
  serviceAccountEmail: string;
  audience: string;
  correlationId: string;
  log: Logger;
}): Promise<RevenueAutomationWorkerAuthResult | null> {
  if (!args.token) return null;
  try {
    const ticket = await googleOidcClient.verifyIdToken({
      idToken: args.token,
      audience: args.audience,
    });
    const payload = ticket.getPayload();
    if (!payload) return null;

    const issuer = asString(payload.iss);
    const email = asString(payload.email).toLowerCase();
    const subject = asString(payload.sub);
    if (
      !GOOGLE_OIDC_ISSUERS.has(issuer) ||
      payload.email_verified !== true ||
      email !== args.serviceAccountEmail ||
      !subject
    ) {
      args.log.warn("revenue.worker_auth.oidc_claims_rejected", {
        correlationId: args.correlationId,
        issuerAllowed: GOOGLE_OIDC_ISSUERS.has(issuer),
        emailVerified: payload.email_verified === true,
        principalMatched: email === args.serviceAccountEmail,
        subjectPresent: Boolean(subject),
      });
      return null;
    }

    return {
      mode: "oidc",
      principalHash: principalHash(`${email}|${subject}`),
    };
  } catch {
    args.log.warn("revenue.worker_auth.oidc_token_rejected", {
      correlationId: args.correlationId,
    });
    return null;
  }
}

/**
 * Authorizes the consolidated revenue workers.
 *
 * OIDC is the steady-state path. The legacy token path is accepted only while
 * REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN is explicitly true, which supports a
 * bounded canary deployment before the token and flag are removed.
 */
export async function authorizeRevenueAutomationWorker(args: {
  request: Request;
  correlationId: string;
  log: Logger;
}): Promise<RevenueAutomationWorkerAuthResult> {
  const oidc = readOidcConfiguration();
  const bearerToken = readBearerToken(args.request);

  if (oidc.configured) {
    const verified = await verifySchedulerOidc({
      token: bearerToken,
      serviceAccountEmail: oidc.serviceAccountEmail,
      audience: oidc.audience,
      correlationId: args.correlationId,
      log: args.log,
    });
    if (verified) {
      args.log.info("revenue.worker_auth.authorized", {
        correlationId: args.correlationId,
        mode: verified.mode,
        principalHash: verified.principalHash,
      });
      return verified;
    }
  }

  if (parseExplicitBoolean(process.env.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN)) {
    const configuredLegacyTokens = readLegacyWorkerTokens();
    if (configuredLegacyTokens.length === 0) {
      throw new ApiError(
        503,
        "Legacy revenue worker authentication is enabled but no legacy token is configured."
      );
    }
    const candidateTokens = Array.from(
      new Set(
        [
          args.request.headers.get("x-revenue-automation-token"),
          args.request.headers.get("x-revenue-day30-token"),
          args.request.headers.get("x-revenue-day2-token"),
          args.request.headers.get("x-revenue-day1-token"),
          args.request.headers.get("x-revenue-pos-token"),
          args.request.headers.get("x-revenue-weekly-kpi-token"),
          bearerToken,
        ]
          .map(asString)
          .filter(Boolean)
      )
    );
    let legacyMatched = false;
    for (const candidate of candidateTokens) {
      for (const configured of configuredLegacyTokens) {
        legacyMatched = constantTimeEqual(candidate, configured) || legacyMatched;
      }
    }
    if (legacyMatched) {
      const result: RevenueAutomationWorkerAuthResult = {
        mode: "legacy_token",
        principalHash: principalHash("legacy-revenue-worker"),
      };
      args.log.warn("revenue.worker_auth.legacy_authorized", {
        correlationId: args.correlationId,
        mode: result.mode,
        principalHash: result.principalHash,
        removalRequired: true,
      });
      return result;
    }
  }

  if (!oidc.configured && !parseExplicitBoolean(process.env.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN)) {
    throw new ApiError(503, "Revenue worker authentication is not configured.");
  }

  throw new ApiError(403, "Forbidden");
}
