import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { getStoredGoogleTokens } from "@/lib/google/oauth";
import {
  buildRuntimePreflightReport,
  type RuntimeConfigCheck,
  type RuntimePreflightReport,
} from "@/lib/runtime/preflight";

export const SOCIAL_ONBOARDING_STEP_IDS = [
  "google_workspace_connected",
  "approval_base_url_configured",
  "approval_webhook_configured",
  "worker_auth_configured",
  "smauto_connector_configured",
  "smauto_auth_configured",
  "dispatch_status_notifications_configured",
  "social_accounts_selected",
] as const;

export type SocialOnboardingStepId = (typeof SOCIAL_ONBOARDING_STEP_IDS)[number];

export interface SocialOnboardingStep {
  id: SocialOnboardingStepId;
  label: string;
  detail: string;
  state: "ready" | "needs_action";
  actionLabel: string | null;
  actionHref: string | null;
  canToggle: boolean;
}

export interface SocialPipelineHealthSummary {
  drafts: {
    pendingApproval: number;
    approved: number;
    rejected: number;
    failed: number;
  };
  dispatch: {
    pendingExternalTool: number;
    dispatched: number;
    failed: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
}

export interface SocialOnboardingStatus {
  ready: boolean;
  steps: SocialOnboardingStep[];
  completedStepIds: SocialOnboardingStepId[];
  pipeline: SocialPipelineHealthSummary;
  diagnostics: {
    status: RuntimePreflightReport["status"];
    checks: RuntimeConfigCheck[];
    generatedAt: string;
  };
}

interface SocialOnboardingProgressDoc {
  completedStepIds?: unknown;
}

function socialDraftCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_drafts");
}

function socialDispatchQueueCollection(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("social_dispatch_queue");
}

function socialOnboardingProgressDoc(uid: string) {
  return getAdminDb().collection("identities").doc(uid).collection("onboarding").doc("social");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function runtimeCheckReady(
  checksById: Map<string, RuntimeConfigCheck>,
  id: string
): { ready: boolean; detail: string } {
  const check = checksById.get(id);
  if (!check) {
    return {
      ready: false,
      detail: "Runtime preflight check missing; run diagnostics in Settings.",
    };
  }
  return { ready: check.state === "ok", detail: check.detail };
}

function normalizeCompletedStepIds(value: unknown): SocialOnboardingStepId[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<SocialOnboardingStepId>(SOCIAL_ONBOARDING_STEP_IDS);
  const completed: SocialOnboardingStepId[] = [];
  for (const item of value) {
    const candidate = asString(item) as SocialOnboardingStepId;
    if (!allowed.has(candidate)) continue;
    if (!completed.includes(candidate)) completed.push(candidate);
  }
  return completed;
}

function maxTimestampFromDocs(
  docs: Array<{ data: () => Record<string, unknown> }>,
  candidateFields: string[]
): string | null {
  let latestMs = 0;
  for (const doc of docs) {
    const row = doc.data();
    for (const field of candidateFields) {
      const iso = asIsoTimestamp(row[field]);
      if (!iso) continue;
      const parsedMs = Date.parse(iso);
      if (Number.isFinite(parsedMs) && parsedMs > latestMs) latestMs = parsedMs;
    }
  }
  if (!latestMs) return null;
  return new Date(latestMs).toISOString();
}

export function buildSocialOnboardingSteps(args: {
  googleConnected: boolean;
  preflight: RuntimePreflightReport;
  completedStepIds: SocialOnboardingStepId[];
  socialConnectionsUrl: string | null;
}): SocialOnboardingStep[] {
  const checksById = new Map(args.preflight.checks.map((check) => [check.id, check]));
  const completed = new Set(args.completedStepIds);
  const approvalBase = runtimeCheckReady(checksById, "social-draft-approval-base-url");
  const approvalWebhook = runtimeCheckReady(checksById, "social-draft-webhook");
  const workerAuth = runtimeCheckReady(checksById, "social-draft-worker-token");
  const connector = runtimeCheckReady(checksById, "smauto-mcp-connector");
  const auth = runtimeCheckReady(checksById, "smauto-mcp-auth");
  const dispatchNotify = runtimeCheckReady(checksById, "social-dispatch-status-webhook");

  return [
    {
      id: "google_workspace_connected",
      label: "Connect Google Workspace",
      detail: args.googleConnected
        ? "Google account connected for integrations and approvals."
        : "Connect Google Workspace to unlock full operator workflow.",
      state: args.googleConnected ? "ready" : "needs_action",
      actionLabel: args.googleConnected ? null : "Open Integrations",
      actionHref: args.googleConnected ? null : "/dashboard/integrations",
      canToggle: false,
    },
    {
      id: "approval_base_url_configured",
      label: "Configure approval base URL",
      detail: approvalBase.detail,
      state: approvalBase.ready ? "ready" : "needs_action",
      actionLabel: approvalBase.ready ? null : "Open API Vault",
      actionHref: approvalBase.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "approval_webhook_configured",
      label: "Configure Google Space approval webhook",
      detail: approvalWebhook.detail,
      state: approvalWebhook.ready ? "ready" : "needs_action",
      actionLabel: approvalWebhook.ready ? null : "Open API Vault",
      actionHref: approvalWebhook.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "worker_auth_configured",
      label: "Configure worker auth token/OIDC",
      detail: workerAuth.detail,
      state: workerAuth.ready ? "ready" : "needs_action",
      actionLabel: workerAuth.ready ? null : "Open API Vault",
      actionHref: workerAuth.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "smauto_connector_configured",
      label: "Configure SMAuto connector endpoint",
      detail: connector.detail,
      state: connector.ready ? "ready" : "needs_action",
      actionLabel: connector.ready ? null : "Open API Vault",
      actionHref: connector.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "smauto_auth_configured",
      label: "Configure SMAuto auth mode",
      detail: auth.detail,
      state: auth.ready ? "ready" : "needs_action",
      actionLabel: auth.ready ? null : "Open API Vault",
      actionHref: auth.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "dispatch_status_notifications_configured",
      label: "Enable dispatch status notifications",
      detail: dispatchNotify.detail,
      state: dispatchNotify.ready ? "ready" : "needs_action",
      actionLabel: dispatchNotify.ready ? null : "Open API Vault",
      actionHref: dispatchNotify.ready ? null : "/dashboard/settings?tab=integrations",
      canToggle: false,
    },
    {
      id: "social_accounts_selected",
      label: "Select Facebook Page + Instagram account",
      detail: completed.has("social_accounts_selected")
        ? "Account pairing confirmed."
        : "Finish account selection in SocialOps connections UI, then mark complete.",
      state: completed.has("social_accounts_selected") ? "ready" : "needs_action",
      actionLabel: args.socialConnectionsUrl ? "Open Social Connections" : null,
      actionHref: args.socialConnectionsUrl,
      canToggle: true,
    },
  ];
}

export async function getSocialPipelineHealthSummary(uid: string): Promise<SocialPipelineHealthSummary> {
  const draftsRef = socialDraftCollection(uid);
  const queueRef = socialDispatchQueueCollection(uid);

  const [
    pendingApprovalDrafts,
    approvedDrafts,
    rejectedDrafts,
    failedDrafts,
    pendingDispatchQueue,
    dispatchedQueue,
    failedDispatchQueue,
  ] = await Promise.all([
    draftsRef.where("status", "==", "pending_approval").get(),
    draftsRef.where("status", "==", "approved").get(),
    draftsRef.where("status", "==", "rejected").get(),
    draftsRef.where("status", "==", "failed").get(),
    queueRef.where("status", "==", "pending_external_tool").get(),
    queueRef.where("status", "==", "dispatched").get(),
    queueRef.where("status", "==", "failed").get(),
  ]);

  return {
    drafts: {
      pendingApproval: pendingApprovalDrafts.size,
      approved: approvedDrafts.size,
      rejected: rejectedDrafts.size,
      failed: failedDrafts.size,
    },
    dispatch: {
      pendingExternalTool: pendingDispatchQueue.size,
      dispatched: dispatchedQueue.size,
      failed: failedDispatchQueue.size,
      lastSuccessAt: maxTimestampFromDocs(dispatchedQueue.docs, ["dispatchedAt", "updatedAt"]),
      lastFailureAt: maxTimestampFromDocs(failedDispatchQueue.docs, ["failedAt", "updatedAt"]),
    },
  };
}

export async function getSocialOnboardingStatus(uid: string): Promise<SocialOnboardingStatus> {
  const [tokens, preflight, progressSnap, pipeline] = await Promise.all([
    getStoredGoogleTokens(uid),
    Promise.resolve(buildRuntimePreflightReport()),
    socialOnboardingProgressDoc(uid).get(),
    getSocialPipelineHealthSummary(uid),
  ]);

  const scopeString = asString(tokens?.scope);
  const googleConnected =
    Boolean(tokens?.refreshToken || tokens?.accessToken) ||
    scopeString.includes("/auth/drive") ||
    scopeString.includes("/auth/calendar") ||
    scopeString.includes("/auth/gmail");

  const completedStepIds = normalizeCompletedStepIds(
    (progressSnap.data() as SocialOnboardingProgressDoc | undefined)?.completedStepIds
  );

  const socialConnectionsUrl = asString(process.env.NEXT_PUBLIC_SOCIALOPS_CONNECTIONS_URL) || null;
  const steps = buildSocialOnboardingSteps({
    googleConnected,
    preflight,
    completedStepIds,
    socialConnectionsUrl,
  });

  const ready = steps.every((step) => step.state === "ready");
  const diagnosticsChecks = preflight.checks.filter(
    (check) =>
      check.id.startsWith("social-") || check.id.startsWith("smauto-") || check.id === "leadops-mcp-connector"
  );

  return {
    ready,
    steps,
    completedStepIds,
    pipeline,
    diagnostics: {
      status: preflight.status,
      checks: diagnosticsChecks,
      generatedAt: preflight.generatedAt,
    },
  };
}

export async function setSocialOnboardingStepCompletion(args: {
  uid: string;
  stepId: SocialOnboardingStepId;
  completed: boolean;
}): Promise<SocialOnboardingStepId[]> {
  if (!SOCIAL_ONBOARDING_STEP_IDS.includes(args.stepId)) {
    throw new ApiError(400, "Invalid onboarding step id");
  }

  const ref = socialOnboardingProgressDoc(args.uid);
  await ref.set(
    {
      completedStepIds: args.completed
        ? FieldValue.arrayUnion(args.stepId)
        : FieldValue.arrayRemove(args.stepId),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const updated = await ref.get();
  const completed = normalizeCompletedStepIds(
    (updated.data() as SocialOnboardingProgressDoc | undefined)?.completedStepIds
  );
  return completed;
}
