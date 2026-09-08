import "server-only";

import { timingSafeEqual } from "crypto";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseCsv(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function secureTokenEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (candidateBuffer.length !== expectedBuffer.length || candidateBuffer.length === 0) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

function readBearer(request: Request): string {
  const authorization = normalized(request.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

export function requireSecondBrainOperatorUid(): string {
  const operatorUid = normalized(process.env.SECOND_BRAIN_OPERATOR_UID);
  if (!operatorUid) throw new ApiError(503, "SECOND_BRAIN_OPERATOR_UID is not configured");
  return operatorUid;
}

export function assertSecondBrainOperatorUid(candidateUid: string): string {
  const operatorUid = requireSecondBrainOperatorUid();
  if (normalized(candidateUid) !== operatorUid) {
    throw new ApiError(403, "Second-brain operator UID mismatch");
  }
  return operatorUid;
}

export async function authorizeSecondBrainService(args: {
  request: Request;
  log?: Logger;
  route: string;
}): Promise<void> {
  const expected = normalized(process.env.SECOND_BRAIN_SERVICE_TOKEN);
  if (!expected) {
    throw new ApiError(503, "SECOND_BRAIN_SERVICE_TOKEN is not configured");
  }
  const candidate = normalized(args.request.headers.get("x-second-brain-token")) || readBearer(args.request);
  if (!secureTokenEqual(candidate, expected)) {
    args.log?.warn("second_brain.service_auth.failed", { route: args.route });
    throw new ApiError(403, "Forbidden");
  }
}

export function assertSecondBrainReviewerAllowed(user: { uid: string; email?: string }): void {
  const allowedUids = parseCsv(process.env.SECOND_BRAIN_REVIEW_ALLOWED_UIDS);
  const allowedEmails = parseCsv(process.env.SECOND_BRAIN_REVIEW_EMAILS).map((email) => email.toLowerCase());
  if (allowedUids.length === 0 || allowedEmails.length === 0) {
    throw new ApiError(503, "Second-brain reviewer UID and email allowlists are not configured");
  }
  if (!allowedUids.includes(user.uid)) {
    throw new ApiError(403, "Reviewer is not allowlisted");
  }

  const email = normalized(user.email).toLowerCase();
  if (!email || !allowedEmails.includes(email)) throw new ApiError(403, "Reviewer email is not allowlisted");
}

export function configuredReviewEmails(): string[] {
  return Array.from(new Set(parseCsv(process.env.SECOND_BRAIN_REVIEW_EMAILS).map((email) => email.toLowerCase())));
}
