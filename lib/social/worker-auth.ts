import "server-only";

import { OAuth2Client } from "google-auth-library";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";

const googleOidcClient = new OAuth2Client();
const GOOGLE_OIDC_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readConfiguredWorkerToken(): string {
  const primary = asString(process.env.SOCIAL_DRAFT_WORKER_TOKEN);
  if (primary) return primary;
  const day30 = asString(process.env.REVENUE_DAY30_WORKER_TOKEN);
  if (day30) return day30;
  const day2 = asString(process.env.REVENUE_DAY2_WORKER_TOKEN);
  if (day2) return day2;
  return asString(process.env.REVENUE_DAY1_WORKER_TOKEN);
}

function readAllowedSchedulerServiceAccounts(): string[] {
  const configured = asString(process.env.SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS);
  if (!configured) return [];
  return Array.from(new Set(parseCsv(configured).map((email) => email.toLowerCase())));
}

function normalizeAudienceFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function readAllowedOidcAudiences(request: Request): string[] {
  const configured = asString(process.env.SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES);
  if (configured) return Array.from(new Set(parseCsv(configured)));
  return [normalizeAudienceFromRequest(request)];
}

async function isValidSchedulerOidcToken(args: {
  request: Request;
  allowedServiceAccounts: string[];
  log?: Logger;
  route?: string;
}): Promise<boolean> {
  const token = readBearerToken(args.request);
  if (!token) return false;

  const allowedAudiences = readAllowedOidcAudiences(args.request);
  try {
    const ticket = await googleOidcClient.verifyIdToken({
      idToken: token,
      audience: allowedAudiences,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;

    const issuer = asString(payload.iss);
    if (!GOOGLE_OIDC_ISSUERS.has(issuer)) return false;

    const email = asString(payload.email).toLowerCase();
    if (!email || !args.allowedServiceAccounts.includes(email)) {
      args.log?.warn("social.drafts.worker_auth.oidc_email_not_allowed", {
        route: args.route || null,
        email: email || null,
      });
      return false;
    }

    return true;
  } catch (error) {
    args.log?.warn("social.drafts.worker_auth.oidc_invalid", {
      route: args.route || null,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function authorizeSocialDraftWorker(args: {
  request: Request;
  log?: Logger;
  route?: string;
}): Promise<void> {
  const configuredToken = readConfiguredWorkerToken();
  const candidateToken =
    asString(args.request.headers.get("x-social-draft-token")) || readBearerToken(args.request);

  if (configuredToken && candidateToken && candidateToken === configuredToken) return;

  const allowedServiceAccounts = readAllowedSchedulerServiceAccounts();
  if (allowedServiceAccounts.length > 0) {
    const oidcOk = await isValidSchedulerOidcToken({
      request: args.request,
      allowedServiceAccounts,
      log: args.log,
      route: args.route,
    });
    if (oidcOk) return;
  }

  if (!configuredToken && allowedServiceAccounts.length === 0) {
    throw new ApiError(
      503,
      "Missing worker auth configuration. Set SOCIAL_DRAFT_WORKER_TOKEN or SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS."
    );
  }

  throw new ApiError(403, "Forbidden");
}
