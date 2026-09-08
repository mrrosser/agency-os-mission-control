import "server-only";

import { createHmac, randomBytes } from "crypto";
import { FieldPath } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { assertSecondBrainOperatorUid } from "@/lib/second-brain-auth";
import {
  SecondBrainCandidateSchema,
  SecondBrainHealthSchema,
  SecondBrainReviewRecordSchema,
  SecondBrainSnapshotSchema,
  type SecondBrainCandidate,
  type SecondBrainCandidateSyncRequest,
  type SecondBrainDecision,
  type SecondBrainReviewRecord,
  type SecondBrainSnapshot,
} from "@/lib/second-brain-contract";

const OPERATOR_COLLECTION = "second_brain_operators";
const EMAIL_ACTION_COLLECTION = "second_brain_email_actions";

function nowIso(): string {
  return new Date().toISOString();
}

function operatorRef(uid: string) {
  return getAdminDb().collection(OPERATOR_COLLECTION).doc(uid);
}

function candidateRef(uid: string, candidateId: string) {
  return operatorRef(uid).collection("candidates").doc(candidateId);
}

function decisionRef(uid: string, candidateId: string) {
  return operatorRef(uid).collection("decisions").doc(candidateId);
}

function notificationRef(uid: string, notificationId: string) {
  return operatorRef(uid).collection("notifications").doc(notificationId);
}

function emailActionSecret(): string {
  const value = String(process.env.SECOND_BRAIN_EMAIL_ACTION_SECRET || "").trim();
  if (value.length < 32) throw new ApiError(503, "SECOND_BRAIN_EMAIL_ACTION_SECRET must contain at least 32 characters");
  return value;
}

export function hashSecondBrainEmailActionToken(token: string): string {
  return createHmac("sha256", emailActionSecret()).update(token).digest("hex");
}

export function validateSecondBrainEmailActionState(
  action: Record<string, unknown>,
  expected: {
    reviewerUid: string;
    reviewerEmail?: string | null;
    candidateId?: string;
    candidateHash?: string;
    decision?: SecondBrainDecision;
    operatorUid?: string;
    nowMs?: number;
  }
): void {
  const reviewerEmail = String(expected.reviewerEmail || "").toLowerCase();
  if (String(action.recipientUid || "") !== expected.reviewerUid || String(action.recipientEmail || "").toLowerCase() !== reviewerEmail) {
    throw new ApiError(403, "Email action belongs to another reviewer");
  }
  if (action.usedAt) throw new ApiError(409, "Email action has already been used");
  const expiresAtMs = Date.parse(String(action.expiresAt || ""));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= (expected.nowMs ?? Date.now())) {
    throw new ApiError(410, "Email action has expired");
  }
  if (expected.operatorUid && String(action.uid || "") !== expected.operatorUid) {
    throw new ApiError(403, "Email action belongs to another operator");
  }
  if (expected.candidateId && String(action.candidateId || "") !== expected.candidateId) throw new ApiError(409, "Email action candidate mismatch");
  if (expected.candidateHash && String(action.candidateHash || "") !== expected.candidateHash) throw new ApiError(409, "Email action candidate no longer matches");
  if (expected.decision && String(action.decision || "") !== expected.decision) throw new ApiError(409, "Email action decision mismatch");
}

function statusAfterDecision(decision: SecondBrainDecision): SecondBrainCandidate["status"] {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return decision;
}

export function parseSecondBrainCandidateDocument(
  value: Record<string, unknown>,
  candidateId = String(value.candidateId || "")
): SecondBrainCandidate {
  return SecondBrainCandidateSchema.parse({
    candidateId,
    candidateHash: value.candidateHash,
    skillName: value.skillName,
    purpose: value.purpose,
    status: value.status,
    generatedAt: value.generatedAt,
    evaluatorVersion: value.evaluatorVersion,
    caseCount: value.caseCount,
    qualityDeltaPoints: value.qualityDeltaPoints,
    efficiencyImprovement: value.efficiencyImprovement,
    evidenceCount: value.evidenceCount,
    riskFlags: value.riskFlags,
    safeDiffSummary: value.safeDiffSummary,
    correlationId: value.correlationId,
  });
}

function parseSecondBrainSnapshotCandidate(value: Record<string, unknown>, candidateId: string) {
  const candidate = parseSecondBrainCandidateDocument(value, candidateId);
  const review = value.review == null ? null : SecondBrainReviewRecordSchema.parse(value.review);
  return { ...candidate, review };
}

export function resolveSecondBrainCandidateSyncState(args: {
  incoming: SecondBrainCandidate;
  existing?: Record<string, unknown> | null;
  decision?: SecondBrainReviewRecord | null;
}): { status: SecondBrainCandidate["status"]; review: SecondBrainReviewRecord | null; preservedTerminal: boolean } {
  const existingHash = String(args.existing?.candidateHash || "");
  if (existingHash && existingHash !== args.incoming.candidateHash) {
    throw new ApiError(409, "Candidate ID is already bound to a different hash");
  }
  const review = args.decision || null;
  if (review && review.candidateHash !== args.incoming.candidateHash) {
    throw new ApiError(409, "Candidate decision hash does not match the synchronized candidate");
  }
  const existingStatus = String(args.existing?.status || "");
  if (["promoted", "reverted"].includes(existingStatus)) {
    if (review?.decision !== "approve") throw new ApiError(409, "Existing runtime terminal status lacks its matching approval decision");
    if (existingStatus === "promoted" && args.incoming.status === "reverted") {
      return { status: "reverted", review, preservedTerminal: false };
    }
    return { status: existingStatus as SecondBrainCandidate["status"], review, preservedTerminal: true };
  }
  if (["promoted", "reverted"].includes(args.incoming.status)) {
    if (review?.decision !== "approve") throw new ApiError(409, "Runtime terminal status requires a matching approval decision");
    return { status: args.incoming.status, review, preservedTerminal: false };
  }
  if (review) return { status: statusAfterDecision(review.decision), review, preservedTerminal: false };
  if (args.incoming.status === "approved") {
    return { status: "reviewable", review: null, preservedTerminal: false };
  }
  return { status: args.incoming.status, review: null, preservedTerminal: false };
}

export async function syncSecondBrainCandidates(
  payload: SecondBrainCandidateSyncRequest,
  context: { correlationId: string }
): Promise<{ syncedCount: number; preservedTerminalCount: number }> {
  const db = getAdminDb();
  return db.runTransaction(async (transaction) => {
    const reads = [];
    for (const candidate of payload.candidates) {
      const candidateDocument = candidateRef(payload.uid, candidate.candidateId);
      const decisionDocument = decisionRef(payload.uid, candidate.candidateId);
      const candidateSnapshot = await transaction.get(candidateDocument);
      const decisionSnapshot = await transaction.get(decisionDocument);
      reads.push({ candidate, candidateDocument, candidateSnapshot, decisionSnapshot });
    }

    let preservedTerminalCount = 0;
    const updatedAt = nowIso();
    for (const item of reads) {
      const existing = item.candidateSnapshot.exists ? item.candidateSnapshot.data() || null : null;
      const decision = item.decisionSnapshot.exists
        ? SecondBrainReviewRecordSchema.parse(item.decisionSnapshot.data())
        : null;
      const resolved = resolveSecondBrainCandidateSyncState({ incoming: item.candidate, existing, decision });
      if (resolved.preservedTerminal) preservedTerminalCount += 1;
      transaction.set(item.candidateDocument, {
        ...item.candidate,
        status: resolved.status,
        review: resolved.review,
        firstSeenAt: existing?.firstSeenAt || updatedAt,
        updatedAt,
        correlationId: context.correlationId,
      }, { merge: true });
    }

    if (payload.health) {
      transaction.set(operatorRef(payload.uid).collection("health").doc("current"), {
        ...payload.health,
        updatedAt,
        correlationId: context.correlationId,
      }, { merge: true });
    }
    transaction.set(operatorRef(payload.uid), {
      uid: payload.uid,
      lastSyncAt: payload.generatedAt,
      updatedAt,
      correlationId: context.correlationId,
    }, { merge: true });
    return { syncedCount: payload.candidates.length, preservedTerminalCount };
  });
}

export async function getSecondBrainSnapshot(uid: string): Promise<SecondBrainSnapshot> {
  const [candidateSnapshot, decisionSnapshot, notificationSnapshot, healthSnapshot] = await Promise.all([
    operatorRef(uid).collection("candidates").limit(100).get(),
    operatorRef(uid).collection("decisions").limit(100).get(),
    operatorRef(uid).collection("notifications").limit(100).get(),
    operatorRef(uid).collection("health").doc("current").get(),
  ]);

  const candidates = candidateSnapshot.docs
    .map((doc) => ({ ...doc.data(), candidateId: doc.id }) as Record<string, unknown>)
    .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")))
    .map((value) => parseSecondBrainSnapshotCandidate(value, String(value.candidateId || "")));
  const decisions = decisionSnapshot.docs
    .map((doc) => SecondBrainReviewRecordSchema.parse(doc.data()))
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  const notifications = notificationSnapshot.docs
    .map((doc) => ({ ...doc.data(), notificationId: doc.id }) as Record<string, unknown>)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 50);
  const health = healthSnapshot.exists ? SecondBrainHealthSchema.parse(healthSnapshot.data()) : null;

  return SecondBrainSnapshotSchema.parse({
    generatedAt: nowIso(),
    health,
    candidates,
    decisions,
    notifications,
  });
}

async function writeReviewTransaction(args: {
  uid: string;
  candidateId: string;
  candidateHash: string;
  decision: SecondBrainDecision;
  reasonCode: string;
  notes?: string;
  reviewerUid: string;
  reviewerEmail?: string | null;
  correlationId: string;
  idempotencyKey: string;
  source: "mission-control" | "email-action";
  emailActionHash?: string;
}): Promise<SecondBrainReviewRecord> {
  const db = getAdminDb();
  const candidateDocument = candidateRef(args.uid, args.candidateId);
  const decisionDocument = decisionRef(args.uid, args.candidateId);
  const emailActionDocument = args.emailActionHash
    ? db.collection(EMAIL_ACTION_COLLECTION).doc(args.emailActionHash)
    : null;
  const reviewedAt = nowIso();

  return db.runTransaction(async (transaction) => {
    const candidateSnapshot = await transaction.get(candidateDocument);
    if (!candidateSnapshot.exists) throw new ApiError(404, "Second-brain candidate not found");
    const candidate = candidateSnapshot.data() || {};
    if (String(candidate.candidateHash || "") !== args.candidateHash) {
      throw new ApiError(409, "Candidate hash no longer matches");
    }
    if (["promoted", "reverted"].includes(String(candidate.status || ""))) {
      throw new ApiError(409, "Candidate is already in a terminal runtime state");
    }
    if (args.decision === "approve" && String(candidate.status || "") !== "reviewable") {
      throw new ApiError(409, "Only a reviewable candidate can be approved");
    }

    const existingDecision = await transaction.get(decisionDocument);
    if (existingDecision.exists) throw new ApiError(409, "Candidate has already been reviewed");

    if (emailActionDocument) {
      const tokenSnapshot = await transaction.get(emailActionDocument);
      if (!tokenSnapshot.exists) throw new ApiError(404, "Email action is invalid");
      const token = tokenSnapshot.data() || {};
      const tokenOperatorUid = assertSecondBrainOperatorUid(String(token.uid || ""));
      if (tokenOperatorUid !== args.uid) {
        throw new ApiError(409, "Email action operator no longer matches");
      }
      validateSecondBrainEmailActionState(token, {
        reviewerUid: args.reviewerUid,
        reviewerEmail: args.reviewerEmail,
        candidateId: args.candidateId,
        candidateHash: args.candidateHash,
        decision: args.decision,
        operatorUid: args.uid,
      });
      transaction.update(emailActionDocument, { usedAt: reviewedAt, usedByUid: args.reviewerUid, correlationId: args.correlationId });
    }

    const review = SecondBrainReviewRecordSchema.parse({
      candidateId: args.candidateId,
      candidateHash: args.candidateHash,
      decision: args.decision,
      reasonCode: args.reasonCode,
      notes: args.notes || "",
      reviewerUid: args.reviewerUid,
      reviewerEmail: args.reviewerEmail || null,
      reviewedAt,
      correlationId: args.correlationId,
      idempotencyKey: args.idempotencyKey,
      source: args.source,
    });
    transaction.set(decisionDocument, review, { merge: false });
    transaction.update(candidateDocument, {
      status: statusAfterDecision(args.decision),
      review,
      updatedAt: reviewedAt,
    });
    return review;
  });
}

export async function recordSecondBrainReview(args: {
  uid: string;
  candidateId: string;
  candidateHash: string;
  decision: SecondBrainDecision;
  reasonCode: string;
  notes?: string;
  reviewerUid: string;
  reviewerEmail?: string | null;
  correlationId: string;
  idempotencyKey: string;
}): Promise<SecondBrainReviewRecord> {
  return writeReviewTransaction({ ...args, source: "mission-control" });
}

export async function listSecondBrainDecisions(args: {
  uid: string;
  cursor?: string;
  after?: string;
  limit?: number;
}): Promise<{ decisions: SecondBrainReviewRecord[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, args.limit || 25));
  let query = operatorRef(args.uid)
    .collection("decisions")
    .orderBy("reviewedAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(limit);
  if (args.cursor) {
    let decoded: { reviewedAt: string; documentId: string };
    try {
      decoded = JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8"));
    } catch {
      throw new ApiError(400, "Decision cursor is invalid");
    }
    if (!decoded.reviewedAt || !decoded.documentId) throw new ApiError(400, "Decision cursor is invalid");
    query = query.startAfter(decoded.reviewedAt, decoded.documentId);
  } else if (args.after) {
    if (Number.isNaN(Date.parse(args.after))) throw new ApiError(400, "Decision timestamp cursor is invalid");
    query = query.where("reviewedAt", ">", args.after);
  }
  const snapshot = await query.get();
  const decisions = snapshot.docs.map((doc) => SecondBrainReviewRecordSchema.parse(doc.data()));
  const last = snapshot.docs.at(-1);
  const nextCursor = last
    ? Buffer.from(JSON.stringify({ reviewedAt: String(last.data().reviewedAt), documentId: last.id }), "utf8").toString("base64url")
    : args.cursor || null;
  return { decisions, nextCursor };
}

export async function createSecondBrainEmailAction(args: {
  uid: string;
  candidate: SecondBrainCandidate;
  decision: Exclude<SecondBrainDecision, "needs-human">;
  recipientUid: string;
  recipientEmail: string;
  correlationId: string;
  expiresInHours?: number;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSecondBrainEmailActionToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + Math.min(24, Math.max(1, args.expiresInHours || 24)) * 3_600_000).toISOString();
  await getAdminDb().collection(EMAIL_ACTION_COLLECTION).doc(tokenHash).create({
    uid: args.uid,
    candidateId: args.candidate.candidateId,
    candidateHash: args.candidate.candidateHash,
    decision: args.decision,
    recipientUid: args.recipientUid,
    recipientEmail: args.recipientEmail.toLowerCase(),
    createdAt,
    expiresAt,
    usedAt: null,
    correlationId: args.correlationId,
  });
  return token;
}

export async function inspectSecondBrainEmailAction(args: {
  token: string;
  reviewerUid: string;
  reviewerEmail?: string | null;
}): Promise<{ candidate: SecondBrainCandidate; decision: SecondBrainDecision; expiresAt: string }> {
  const tokenHash = hashSecondBrainEmailActionToken(args.token);
  const snapshot = await getAdminDb().collection(EMAIL_ACTION_COLLECTION).doc(tokenHash).get();
  if (!snapshot.exists) throw new ApiError(404, "Email action is invalid");
  const action = snapshot.data() || {};
  const operatorUid = assertSecondBrainOperatorUid(String(action.uid || ""));
  validateSecondBrainEmailActionState(action, {
    reviewerUid: args.reviewerUid,
    reviewerEmail: args.reviewerEmail,
    operatorUid,
  });
  const candidateSnapshot = await candidateRef(operatorUid, String(action.candidateId)).get();
  if (!candidateSnapshot.exists) throw new ApiError(404, "Second-brain candidate not found");
  const candidate = parseSecondBrainCandidateDocument(
    candidateSnapshot.data() || {},
    String(action.candidateId || "")
  );
  if (candidate.candidateHash !== String(action.candidateHash || "")) throw new ApiError(409, "Candidate hash no longer matches");
  return { candidate, decision: action.decision as SecondBrainDecision, expiresAt: String(action.expiresAt) };
}

export async function confirmSecondBrainEmailAction(args: {
  token: string;
  reasonCode: string;
  notes?: string;
  reviewerUid: string;
  reviewerEmail?: string | null;
  correlationId: string;
  idempotencyKey: string;
}): Promise<SecondBrainReviewRecord> {
  const tokenHash = hashSecondBrainEmailActionToken(args.token);
  const tokenSnapshot = await getAdminDb().collection(EMAIL_ACTION_COLLECTION).doc(tokenHash).get();
  if (!tokenSnapshot.exists) throw new ApiError(404, "Email action is invalid");
  const action = tokenSnapshot.data() || {};
  const operatorUid = assertSecondBrainOperatorUid(String(action.uid || ""));
  validateSecondBrainEmailActionState(action, {
    reviewerUid: args.reviewerUid,
    reviewerEmail: args.reviewerEmail,
    operatorUid,
  });
  return writeReviewTransaction({
    uid: operatorUid,
    candidateId: String(action.candidateId),
    candidateHash: String(action.candidateHash),
    decision: action.decision as SecondBrainDecision,
    reasonCode: args.reasonCode,
    notes: args.notes,
    reviewerUid: args.reviewerUid,
    reviewerEmail: args.reviewerEmail,
    correlationId: args.correlationId,
    idempotencyKey: args.idempotencyKey,
    source: "email-action",
    emailActionHash: tokenHash,
  });
}

export async function recordSecondBrainNotification(args: {
  uid: string;
  notificationId: string;
  kind: "digest" | "urgent";
  status: "dry-run" | "delivered" | "dead-letter";
  recipientCount: number;
  correlationId: string;
  detail?: string;
  messageIds?: string[];
}): Promise<void> {
  await notificationRef(args.uid, args.notificationId).set({
    notificationId: args.notificationId,
    kind: args.kind,
    status: args.status,
    recipientCount: args.recipientCount,
    correlationId: args.correlationId,
    detail: args.detail || "",
    messageIds: args.messageIds || [],
    createdAt: nowIso(),
  }, { merge: true });
}

export async function getSecondBrainCandidates(args: {
  uid: string;
  candidateIds?: string[];
  reviewableOnly?: boolean;
}): Promise<SecondBrainCandidate[]> {
  const snapshot = await operatorRef(args.uid).collection("candidates").limit(100).get();
  const requested = new Set(args.candidateIds || []);
  return snapshot.docs
    .map((doc) => parseSecondBrainCandidateDocument(doc.data(), doc.id))
    .filter((candidate) => requested.size === 0 || requested.has(candidate.candidateId))
    .filter((candidate) => !args.reviewableOnly || candidate.status === "reviewable")
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
