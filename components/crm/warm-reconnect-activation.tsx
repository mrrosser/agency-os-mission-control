"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleStop,
  ExternalLink,
  KeyRound,
  Loader2,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  buildAuthHeaders,
  getResponseCorrelationId,
  readApiJson,
} from "@/lib/api/client";
import type {
  CreateWarmReconnectPilotRequest,
  WarmReconnectActivationGateState,
  WarmReconnectActivationResponse,
  WarmReconnectCandidate,
  WarmReconnectContentMode,
  WarmReconnectGoogleProfileId,
  WarmReconnectPilotApprovalRequest,
  WarmReconnectPilotLaunchRequest,
  WarmReconnectPilotRecipientView,
  WarmReconnectPilotStopRequest,
  WarmReconnectPilotView,
  WarmReconnectRecipientDecisionRequest,
} from "@/lib/crm/warm-reconnect-activation-types";
import type { WarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect-types";
import { isRosserGallerySendingProfile, ROSSER_GALLERY_SENDING_EMAIL, RT_SOLUTIONS_SENDING_EMAIL } from "@/lib/google/business-profiles";
import {
  assertGoogleConnectionActive,
  GoogleConnectionCancelledError,
  requestGoogleSenderConnection,
  withGoogleConnectionDeadline,
} from "./google-sender-connection-client";

const ACTIVATION_ROUTE = "/api/crm/warm-reconnect/activation";

const APPROVAL_CONFIRMATIONS = [
  ["senderLegalIdentityVerified", "Sender legal identity"],
  ["physicalPostalAddressVerified", "Physical postal address"],
  ["preferencesAndUnsubscribeVerified", "Preferences and unsubscribe"],
  ["suppressionLedgerVerified", "Suppression ledger"],
  ["spfDkimDmarcVerified", "SPF, DKIM, and DMARC"],
  ["replyToMonitored", "Monitored reply-to"],
  ["artworkApprovedForEmail", "Artwork approved for this email"],
  ["exactAudienceReviewed", "Exact five-person audience"],
] as const;

function hasArtwork(contentMode?: WarmReconnectContentMode) {
  return contentMode === "approved_design_v2" || (contentMode ?? "artwork_html") === "artwork_html";
}

function requiredConfirmations(contentMode?: WarmReconnectContentMode) {
  return APPROVAL_CONFIRMATIONS.filter(([key]) =>
    hasArtwork(contentMode) || key !== "artworkApprovedForEmail",
  );
}

type ConfirmationKey = (typeof APPROVAL_CONFIRMATIONS)[number][0];
type MutationAction = "create" | "decision" | "approval" | "launch" | "stop";

type Props = {
  campaign: WarmReconnectCampaignDraft | null;
};

type SenderForm = {
  senderName: string;
  legalEntity: string;
  replyTo: string;
  physicalPostalAddress: string;
  profileId: WarmReconnectGoogleProfileId;
  contentMode: WarmReconnectContentMode;
  artworkEvidenceNote: string;
  artworkApproved: boolean;
};

const EMPTY_CONFIRMATIONS = Object.fromEntries(
  APPROVAL_CONFIRMATIONS.map(([key]) => [key, false]),
) as Record<ConfirmationKey, boolean>;

const INITIAL_SENDER_FORM: SenderForm = {
  senderName: "Marcus Rosser",
  legalEntity: "",
  replyTo: "",
  physicalPostalAddress: "",
  profileId: "rosser_gallery_send",
  contentMode: "approved_design_v2",
  artworkEvidenceNote: "",
  artworkApproved: false,
};

function isActivationResponse(value: unknown): value is WarmReconnectActivationResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.schemaVersion === "crm.warm-reconnect-activation.v1" &&
    row.dataClassification === "authenticated_contact_review" &&
    row.providerActions === "none" &&
    Array.isArray(row.googleProfiles) &&
    Array.isArray(row.candidates) &&
    Array.isArray(row.pilots)
  );
}

function apiMessage(response: Response, body: unknown, fallback: string): string {
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = typeof row.error === "string" && row.error.trim() ? row.error.trim() : fallback;
  const correlationId = getResponseCorrelationId(response);
  return `${message}${correlationId ? ` cid=${correlationId}` : ""}`;
}

function gateStyle(status: WarmReconnectActivationGateState["status"]): string {
  if (status === "verified") return "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100";
  if (status === "failed") return "border-red-300/25 bg-red-300/[0.07] text-red-100";
  if (status === "pending_approval") return "border-cyan-300/25 bg-cyan-300/[0.07] text-cyan-100";
  return "border-amber-300/20 bg-amber-300/[0.05] text-amber-100/80";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function candidateSelected(selected: string[], candidate: WarmReconnectCandidate): boolean {
  return selected.includes(candidate.recipientId);
}

function selectedTuple(selected: string[]): [string, string, string, string, string] | null {
  if (selected.length !== 5) return null;
  return [selected[0], selected[1], selected[2], selected[3], selected[4]];
}

export function WarmReconnectActivation({ campaign }: Props) {
  const { user } = useAuth();
  const [activationData, setActivation] = useState<WarmReconnectActivationResponse | null>(null);
  const [activationOwner, setActivationOwner] = useState<string | null>(null);
  const activation = user && activationOwner === user.uid ? activationData : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [sender, setSender] = useState<SenderForm>(INITIAL_SENDER_FORM);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState<Record<ConfirmationKey, boolean>>({
    ...EMPTY_CONFIRMATIONS,
  });
  const [approvalNote, setApprovalNote] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [connectingProfile, setConnectingProfile] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [mutation, setMutation] = useState<{ action: MutationAction; recipientId?: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const connectionRef = useRef<{ controller: AbortController; ownerUid: string } | null>(null);
  const mountedRef = useRef(true);
  const currentOwnerRef = useRef(user?.uid);
  currentOwnerRef.current = user?.uid;

  const loadActivation = useCallback(async () => {
    if (!user) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const body = await withGoogleConnectionDeadline(async (signal) => {
        const headers = await buildAuthHeaders(user);
        assertGoogleConnectionActive(signal);
        if (currentOwnerRef.current !== user.uid) throw new GoogleConnectionCancelledError();
        const response = await fetch(ACTIVATION_ROUTE, { method: "GET", headers, cache: "no-store", signal });
        const result = await readApiJson<unknown>(response);
        assertGoogleConnectionActive(signal);
        if (!response.ok) throw new Error(apiMessage(response, result, "Activation controls are unavailable"));
        return result;
      }, { signal: controller.signal, timeoutMessage: "Connection status did not finish loading. Refresh connection status when you are ready." });
      if (!mountedRef.current || currentOwnerRef.current !== user.uid || controller.signal.aborted || requestRef.current !== controller) return;
      if (!isActivationResponse(body)) {
        throw new Error("Activation controls returned an invalid fail-closed contract.");
      }
      setActivation(body);
      setActivationOwner(user.uid);
      setSelectedRecipientIds((current) =>
        current.filter((recipientId) => body.candidates.some((candidate) => candidate.recipientId === recipientId)),
      );
    } catch (caught) {
      if (caught instanceof GoogleConnectionCancelledError || (caught instanceof Error && caught.name === "AbortError")) return;
      if (!mountedRef.current || currentOwnerRef.current !== user.uid || requestRef.current !== controller) return;
      setActivation(null);
      setActivationOwner(null);
      const message = caught instanceof Error ? caught.message : "Activation controls are unavailable";
      setError(message);
      setConnectionError(message);
    } finally {
      if (mountedRef.current && requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [user]);

  const cancelConnection = useCallback(() => {
    const attempt = connectionRef.current;
    connectionRef.current = null;
    attempt?.controller.abort();
    if (mountedRef.current) setConnectingProfile(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionRef.current?.controller.abort();
      connectionRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    cancelConnection();
    setConnectionError(null);
    setConnectionNotice(null);
    return () => {
      connectionRef.current?.controller.abort();
      connectionRef.current = null;
    };
  }, [cancelConnection, user?.uid]);

  const refreshConnectionStatus = useCallback(() => {
    cancelConnection();
    setConnectionError(null);
    setConnectionNotice("Checking connection status only. Start a new connection yourself if it is still needed.");
    void loadActivation();
  }, [cancelConnection, loadActivation]);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refreshConnectionStatus();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [refreshConnectionStatus]);

  useEffect(() => {
    if (!user) {
      requestRef.current?.abort();
      setActivation(null);
      setActivationOwner(null);
      setSelectedRecipientIds([]);
      setError(null);
      return;
    }
    void loadActivation();
    return () => requestRef.current?.abort();
  }, [loadActivation, user]);

  async function authenticatedPost<T>(
    path: string,
    payload: unknown,
    requestIdempotencyKey: string = crypto.randomUUID(),
  ): Promise<T> {
    if (!user) throw new Error("Sign in before changing the pilot.");
    const headers = await buildAuthHeaders(user, { idempotencyKey: requestIdempotencyKey });
    const response = await fetch(path, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const body = await readApiJson<unknown>(response);
    if (!response.ok) throw new Error(apiMessage(response, body, "The server rejected this action"));
    return body as T;
  }

  async function connectGoogle(profileId: WarmReconnectGoogleProfileId) {
    if (!user || loading || connectionRef.current) return;
    const profile = activation?.googleProfiles.find((item) => item.profileId === profileId);
    if (!profile) {
      setConnectionError("The server did not authorize that Google profile. Refresh connection status before trying again.");
      return;
    }

    const attempt = { controller: new AbortController(), ownerUid: user.uid };
    connectionRef.current = attempt;
    setConnectingProfile(profileId);
    setConnectionError(null);
    setConnectionNotice(null);
    setError(null);
    const isCurrent = () => mountedRef.current && connectionRef.current === attempt &&
      currentOwnerRef.current === attempt.ownerUid && !attempt.controller.signal.aborted;
    try {
      const idempotencyKey = crypto.randomUUID();
      const authUrl = await requestGoogleSenderConnection({
        profileId: profile.profileId,
        businessId: profile.businessId,
        signal: attempt.controller.signal,
        getAuthHeaders: async () => {
          const headers = await buildAuthHeaders(user, { idempotencyKey });
          if (!isCurrent()) throw new GoogleConnectionCancelledError();
          return headers;
        },
      });
      if (!isCurrent()) return;
      setConnectionNotice("Opening Google in this browser. If you return without finishing, refresh connection status before starting again.");
      window.location.assign(authUrl);
    } catch (caught) {
      if (!isCurrent()) return;
      connectionRef.current = null;
      setConnectingProfile(null);
      if (caught instanceof GoogleConnectionCancelledError) return;
      const message = caught instanceof Error ? caught.message : "Could not connect Google. Refresh connection status before trying again.";
      setConnectionError(message);
      setConnectionNotice(null);
    }
  }

  async function createPilot() {
    const recipients = selectedTuple(selectedRecipientIds);
    const profile = activation?.googleProfiles.find((item) => item.profileId === sender.profileId);
    if (!recipients || !profile || !campaign || mutation) return;

    const idempotencyKey = crypto.randomUUID();
    const payload: CreateWarmReconnectPilotRequest = {
      idempotencyKey,
      campaignPreviewFingerprint: campaign.review.previewFingerprint,
      tranche: "initial_5",
      recipientCap: 5,
      candidateRecipientIds: recipients,
      sender: {
        senderName: sender.senderName.trim(),
        legalEntity: sender.legalEntity.trim(),
        replyTo: sender.replyTo.trim(),
        physicalPostalAddress: sender.physicalPostalAddress.trim(),
        businessId: profile.businessId,
        profileId: profile.profileId,
      },
      contentMode: sender.contentMode,
      ...(hasArtwork(sender.contentMode) ? {
        artworkEmailApproval: {
          approvedForThisEmailCampaign: true as const,
          evidenceNote: sender.artworkEvidenceNote.trim(),
        },
      } : {}),
    };

    setMutation({ action: "create" });
    setError(null);
    try {
      await authenticatedPost("/api/crm/warm-reconnect/pilots", payload, idempotencyKey);
      setSelectedRecipientIds([]);
      await loadActivation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot creation failed");
    } finally {
      setMutation(null);
    }
  }

  async function decideRecipient(
    pilot: WarmReconnectPilotView,
    recipient: WarmReconnectPilotRecipientView,
    decision: "attest_relationship" | "exclude",
  ) {
    if (!pilot.availableActions.canReviewRecipients || mutation) return;
    const note = (decisionNotes[recipient.recipientId] || "").trim();
    if (!note) return;

    const payload: WarmReconnectRecipientDecisionRequest = decision === "attest_relationship"
      ? {
          decision,
          expectedCandidateFingerprint: recipient.candidateFingerprint,
          personallyRecognizedRelationship: true,
          oneTimeReconnectionInvitationOnly: true,
          sourceEvidenceRefs: recipient.sourceEvidence.map((evidence) => evidence.evidenceRef),
          note,
        }
      : {
          decision,
          expectedCandidateFingerprint: recipient.candidateFingerprint,
          note,
        };

    setMutation({ action: "decision", recipientId: recipient.recipientId });
    setError(null);
    try {
      await authenticatedPost(
        `/api/crm/warm-reconnect/pilots/${encodeURIComponent(pilot.pilotId)}/recipients/${encodeURIComponent(recipient.recipientId)}/decision`,
        payload,
      );
      setDecisionNotes((current) => ({ ...current, [recipient.recipientId]: "" }));
      await loadActivation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recipient decision failed");
    } finally {
      setMutation(null);
    }
  }

  async function approvePilot(pilot: WarmReconnectPilotView) {
    if (!pilot.availableActions.canApprove || mutation || !approvalNote.trim()) return;
    if (!requiredConfirmations(pilot.contentMode).every(([key]) => confirmations[key])) return;

    const payload: WarmReconnectPilotApprovalRequest = {
      decision: "approve",
      expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint,
      expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      approvalScope: "exact_five_one_time_reconnection_emails",
      confirmations: {
        senderLegalIdentityVerified: true,
        physicalPostalAddressVerified: true,
        preferencesAndUnsubscribeVerified: true,
        suppressionLedgerVerified: true,
        spfDkimDmarcVerified: true,
        replyToMonitored: true,
        ...(!hasArtwork(pilot.contentMode) ? {} : { artworkApprovedForEmail: true as const }),
        exactAudienceReviewed: true,
      },
      note: approvalNote.trim(),
    };

    setMutation({ action: "approval" });
    setError(null);
    try {
      await authenticatedPost(
        `/api/crm/warm-reconnect/pilots/${encodeURIComponent(pilot.pilotId)}/approval`,
        payload,
      );
      setApprovalNote("");
      setConfirmations({ ...EMPTY_CONFIRMATIONS });
      await loadActivation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot approval failed");
    } finally {
      setMutation(null);
    }
  }

  async function launchPilot(pilot: WarmReconnectPilotView) {
    if (!pilot.availableActions.canLaunch || !pilot.approval || mutation) return;
    const payload: WarmReconnectPilotLaunchRequest = {
      approvalId: pilot.approval.approvalId,
      expectedArtifactFingerprint: pilot.fingerprints.artifactFingerprint,
      expectedAudienceFingerprint: pilot.fingerprints.audienceFingerprint,
      expectedActionFingerprint: pilot.fingerprints.actionFingerprint,
      acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
    };
    setMutation({ action: "launch" });
    setError(null);
    try {
      await authenticatedPost(
        `/api/crm/warm-reconnect/pilots/${encodeURIComponent(pilot.pilotId)}/launch`,
        payload,
      );
      await loadActivation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot launch request failed");
    } finally {
      setMutation(null);
    }
  }

  async function stopPilot(pilot: WarmReconnectPilotView) {
    if (!pilot.availableActions.canStop || mutation || !stopReason.trim()) return;
    const payload: WarmReconnectPilotStopRequest = { reason: stopReason.trim() };
    setMutation({ action: "stop" });
    setError(null);
    try {
      await authenticatedPost(
        `/api/crm/warm-reconnect/pilots/${encodeURIComponent(pilot.pilotId)}/stop`,
        payload,
      );
      setStopReason("");
      await loadActivation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot stop failed");
    } finally {
      setMutation(null);
    }
  }

  const activePilot = activation?.pilots.find((pilot) =>
    !["stopped", "rejected", "stale"].includes(pilot.status),
  ) || null;
  const providerExecutionEnabled = error ? undefined : activation?.constraints?.providerExecutionEnabled;
  const providerStatus = providerExecutionEnabled === true
    ? "Provider execution is enabled."
    : providerExecutionEnabled === false
      ? "Provider execution is currently disabled."
      : "Provider execution status is unknown until live controls load.";
  const providerLaunchLabel = providerExecutionEnabled === true
    ? "provider enabled"
    : providerExecutionEnabled === false
      ? "provider currently disabled"
      : "provider status unknown";
  const visibleConfirmations = requiredConfirmations(activePilot?.contentMode);
  const allConfirmationsChecked = visibleConfirmations.every(([key]) => confirmations[key]);
  const selectedProfile = activation?.googleProfiles.find((profile) => profile.profileId === sender.profileId);
  const createReady = Boolean(
    selectedRecipientIds.length === 5 &&
    campaign &&
    activation &&
    !activation.candidateSummary.truncated &&
    selectedProfile &&
    sender.senderName.trim() &&
    sender.legalEntity.trim() &&
    sender.replyTo.trim() &&
    sender.physicalPostalAddress.trim() &&
    (!hasArtwork(sender.contentMode) ||
      (sender.artworkApproved && sender.artworkEvidenceNote.trim())) &&
    !activePilot,
  );
  const verifiedGates = useMemo(
    () => activePilot?.gates.filter((gate) => gate.status === "verified").length || 0,
    [activePilot],
  );

  return (
    <section
      aria-labelledby="warm-activation-heading"
      className="relative mb-6 overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#071011] shadow-[0_22px_70px_rgba(0,0,0,0.3)]"
      data-testid="warm-reconnect-activation"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" aria-hidden="true" />
      <header className="border-b border-white/10 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">Activation desk · controlled pilot</p>
            <h2 id="warm-activation-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Permission first. Approval and launch stay separate.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              No address becomes opted in automatically. Marcus reviews each relationship before the server can prepare one exact five-person pilot.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {activation ? `${activation.candidateSummary.eligibleForReview} available for review` : "Fail-closed"}
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-2">
        <article className="rounded-xl border border-white/10 bg-black/25 p-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">1. Preferences and unsubscribe</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                Public controls may reduce communication scope. They do not create consent or make an unknown contact eligible.
              </p>
              <a href="/preferences" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200 underline-offset-4 hover:underline">
                Preview preference center <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-white/10 bg-black/25 p-4" data-testid="google-sender-connection-controls">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">2. Choose the sending Google account</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                Marcus completes Google&apos;s consent screen. Connecting an account does not approve, launch, draft, or send anything.
              </p>
              {connectionError && <p role="alert" className="mt-3 rounded-lg border border-red-300/30 bg-red-300/[0.07] p-3 text-sm leading-6 text-red-100">{connectionError}</p>}
              {connectionNotice && <p role="status" className="mt-3 text-xs leading-5 text-cyan-100">{connectionNotice}</p>}
              {connectingProfile && <p role="status" className="mt-3 text-xs leading-5 text-zinc-300">Opening Google… You can refresh connection status below if this attempt was interrupted.</p>}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(activation?.googleProfiles || []).map((profile) => {
                  const ready = Boolean(
                    profile.connected && profile.gmailCapable && profile.accountEmail
                  );
                  const busy = connectingProfile === profile.profileId;
                  return (
                    <div key={profile.profileId} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-zinc-100">{profile.label}</p>
                        <span className={`h-2 w-2 rounded-full ${ready ? "bg-emerald-300" : "bg-amber-300"}`} aria-hidden="true" />
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {ready ? "Gmail send connected" : titleCase(profile.state)}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        Separate send-only connection for {isRosserGallerySendingProfile(profile.profileId)
                          ? ROSSER_GALLERY_SENDING_EMAIL
                          : RT_SOLUTIONS_SENDING_EMAIL}.
                        Your existing work connection stays unchanged.
                      </p>
                      {profile.accountEmail ? (
                        <p className="mt-1 truncate text-[11px] text-zinc-400">
                          Verified sender: {profile.accountEmail}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(connectingProfile) || loading}
                        onClick={() => void connectGoogle(profile.profileId)}
                        className="mt-3 w-full border-white/15 bg-black/20 text-zinc-100 hover:bg-white/10 hover:text-white"
                      >
                        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
                        {busy ? "Opening Google…" : ready ? `Reconnect ${profile.label}` : `Connect ${profile.label}`}
                      </Button>
                    </div>
                  );
                })}
                {!activation?.googleProfiles.length && (
                  <p className="col-span-full rounded-lg border border-dashed border-amber-300/25 p-3 text-xs text-amber-100/70">
                    No server-authorized Google profile is available.
                  </p>
                )}
              </div>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={refreshConnectionStatus} className="mt-3 border-white/15 bg-black/20 text-zinc-100 hover:bg-white/10 hover:text-white">
                <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh connection status
              </Button>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-white/10 bg-black/25 p-4 xl:col-span-2">
          <div className="flex items-start gap-3">
            <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">3. Reconcile exactly five people</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                An address-book entry is relationship evidence, not opt-in. Names and emails below are visible only in this authenticated owner review.
              </p>

              {!activePilot && activation?.candidateSummary.truncated && (
                <div role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                  The email registry is larger than the bounded review window. Selection and pilot creation are paused until the registry has a canonical indexed email lookup; no partial audience can be approved.
                </div>
              )}

              {!activePilot && !activation?.candidateSummary.truncated && Boolean(activation?.candidates.length) && (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <fieldset className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-white/10 p-3">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                      Select 5 · {selectedRecipientIds.length} selected
                    </legend>
                    {activation?.candidates.map((candidate) => {
                      const checked = candidateSelected(selectedRecipientIds, candidate);
                      const selectionFull = selectedRecipientIds.length >= 5 && !checked;
                      return (
                        <label key={candidate.recipientId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={selectionFull || activation.candidateSummary.truncated}
                            onChange={() => setSelectedRecipientIds((current) =>
                              checked
                                ? current.filter((id) => id !== candidate.recipientId)
                                : [...current, candidate.recipientId]
                            )}
                            className="mt-1 h-4 w-4 accent-cyan-300"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-white">{candidate.displayName}</span>
                            <span className="block truncate text-xs text-zinc-400">{candidate.email}</span>
                            <span className="mt-1 block text-[10px] uppercase tracking-wide text-amber-200/70">
                              {titleCase(candidate.permissionState)} · {candidate.sourceEvidence.length} evidence record{candidate.sourceEvidence.length === 1 ? "" : "s"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Frozen sender configuration</p>
                    <input aria-label="Sender name" value={sender.senderName} onChange={(event) => setSender((current) => ({ ...current, senderName: event.target.value }))} placeholder="Sender name" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
                    <input aria-label="Legal entity" value={sender.legalEntity} onChange={(event) => setSender((current) => ({ ...current, legalEntity: event.target.value }))} placeholder="Legal sender entity" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
                    <input aria-label="Reply-to email" type="email" value={sender.replyTo} onChange={(event) => setSender((current) => ({ ...current, replyTo: event.target.value }))} placeholder="Monitored reply-to email" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
                    <textarea aria-label="Physical postal address" value={sender.physicalPostalAddress} onChange={(event) => setSender((current) => ({ ...current, physicalPostalAddress: event.target.value }))} placeholder="Physical postal address shown in email" rows={2} className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
                    <select aria-label="Sending Google profile" value={sender.profileId} onChange={(event) => setSender((current) => ({ ...current, profileId: event.target.value as SenderForm["profileId"] }))} className="w-full rounded-md border border-white/10 bg-[#091112] px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50">
                      {(activation?.googleProfiles || []).map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.label}</option>)}
                    </select>
                    <label className="block text-xs text-zinc-300">
                      Email format
                      <select aria-label="Email format" value={sender.contentMode} onChange={(event) => setSender((current) => ({ ...current, contentMode: event.target.value as WarmReconnectContentMode }))} className="mt-1 w-full rounded-md border border-white/10 bg-[#091112] px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50">
                        <option value="approved_design_v2">Approved v2 design with inline artwork</option>
                        <option value="preference_buttons">Preference buttons (no artwork)</option>
                        <option value="plain_text">Plain text</option>
                        <option value="artwork_html">Email with artwork</option>
                      </select>
                    </label>
                    {!hasArtwork(sender.contentMode) && <details className="rounded-md border border-white/10 p-3 text-xs leading-5 text-zinc-300">
                      <summary className="cursor-pointer font-semibold">Preview invitation text and footer</summary>
                      <p className="mt-2 font-semibold">Subject: {campaign?.copy.subject}</p>
                      <pre className="mt-2 whitespace-pre-wrap font-sans">{campaign?.copy.plainText}</pre>
                      <p className="mt-3">{sender.legalEntity || "[Legal sender entity required]"}</p>
                      <p className="whitespace-pre-wrap">{sender.physicalPostalAddress || "[Postal address required]"}</p>
                      <p className="mt-2">The final email includes your recipient&apos;s preference and unsubscribe links. Preference buttons open a selected choice; the recipient must confirm on the page. Rosser Gallery: https://rossergallery.com · RT.Solutions: https://rt.solutions</p>
                    </details>}
                    {sender.contentMode === "approved_design_v2" && <p className="text-xs leading-5 text-zinc-300">Uses the approved Nurturer design, Gallery crest and RT logo. Each invitation uses the reviewed first name and its own preference links. The saved review includes an inactive preview. Sender: Marcus Rosser / Rosser Gallery; reply-to: {ROSSER_GALLERY_SENDING_EMAIL}; postal footer: 2505 N Tonti St, New Orleans, LA 70117.</p>}
                    {hasArtwork(sender.contentMode) && <>
                    <textarea aria-label="Artwork approval evidence" value={sender.artworkEvidenceNote} onChange={(event) => setSender((current) => ({ ...current, artworkEvidenceNote: event.target.value }))} placeholder="Why this artwork is approved for this exact email" rows={2} className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
                    <label className="flex items-start gap-2 text-xs leading-5 text-zinc-300">
                      <input type="checkbox" checked={sender.artworkApproved} onChange={(event) => setSender((current) => ({ ...current, artworkApproved: event.target.checked }))} className="mt-1 h-4 w-4 accent-cyan-300" />
                      I approve this owned artwork for this exact email campaign.
                    </label>
                    </>}
                    <Button type="button" disabled={!createReady || Boolean(mutation)} onClick={() => void createPilot()} className="w-full bg-cyan-200 text-[#061012] hover:bg-cyan-100">
                      {mutation?.action === "create" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UsersRound aria-hidden="true" />}
                      Prepare exact five-person review
                    </Button>
                  </div>
                </div>
              )}

              {!activePilot && !activation?.candidateSummary.truncated && !activation?.candidates.length && (
                <div className="mt-3 rounded-lg border border-dashed border-amber-300/25 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/75">
                  Zero opted-in contacts are recorded, and the server has not returned any relationship-evidence candidates for review. Approval and launch remain disabled.
                </div>
              )}

              {activePilot && (
                <ul className="mt-4 grid gap-3 lg:grid-cols-2" aria-label="Pilot recipient review">
                  {activePilot.recipients.map((recipient) => {
                    const pending = recipient.decision.status === "pending_review";
                    const busy = mutation?.action === "decision" && mutation.recipientId === recipient.recipientId;
                    return (
                      <li key={recipient.recipientId} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{recipient.displayName}</p>
                            <p className="truncate text-xs text-zinc-400">{recipient.email}</p>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300">
                            {titleCase(recipient.decision.status)}
                          </span>
                        </div>
                        {pending && (
                          <div className="mt-3 space-y-2">
                            <textarea
                              aria-label={`Relationship note for ${recipient.displayName}`}
                              value={decisionNotes[recipient.recipientId] || ""}
                              onChange={(event) => setDecisionNotes((current) => ({ ...current, [recipient.recipientId]: event.target.value }))}
                              placeholder="How do you personally know this person?"
                              rows={2}
                              className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-200/50"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" disabled={!activePilot.availableActions.canReviewRecipients || !decisionNotes[recipient.recipientId]?.trim() || Boolean(mutation)} onClick={() => void decideRecipient(activePilot, recipient, "attest_relationship")} className="bg-cyan-200 text-[#061012] hover:bg-cyan-100">
                                {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />} I recognize this relationship
                              </Button>
                              <Button type="button" size="sm" variant="outline" disabled={!activePilot.availableActions.canReviewRecipients || !decisionNotes[recipient.recipientId]?.trim() || Boolean(mutation)} onClick={() => void decideRecipient(activePilot, recipient, "exclude")} className="border-white/15 bg-black/20 text-zinc-200 hover:bg-white/10 hover:text-white">
                                Exclude
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-white/10 bg-black/25 p-4 xl:col-span-2">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-white">4. Approve, then request launch</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                Approval binds the exact five people, copy, sender account, and fingerprints for 24 hours. Launch is the separate action that authorizes those five Gmail sends. {providerStatus} The provider setting does not approve or launch a pilot.
              </p>

              {activePilot ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {activePilot.gates.map((gate) => (
                        <div key={gate.id} className={`rounded-lg border p-3 text-xs ${gateStyle(gate.status)}`}>
                          <div className="flex items-center justify-between gap-2">
                            <strong>{gate.label}</strong><span className="text-[10px] uppercase">{titleCase(gate.status)}</span>
                          </div>
                          <p className="mt-1 leading-5 opacity-70">{gate.reason}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-zinc-500">{verifiedGates} of {activePilot.gates.length} gates verified · pilot {activePilot.pilotId} · {titleCase(activePilot.status)}</p>
                  </div>

                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                    {!activePilot.approval && (
                      <>
                        <fieldset className="space-y-2">
                          <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Exact approval confirmations</legend>
                          {visibleConfirmations.map(([key, label]) => (
                            <label key={key} className="flex items-start gap-2 text-xs leading-5 text-zinc-300">
                              <input type="checkbox" checked={confirmations[key]} onChange={(event) => setConfirmations((current) => ({ ...current, [key]: event.target.checked }))} className="mt-1 h-4 w-4 accent-cyan-300" /> {label}
                            </label>
                          ))}
                        </fieldset>
                        <textarea aria-label="Approval note" value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Approval note for this exact pilot" rows={2} className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-200/50" />
                        <Button type="button" disabled={!activePilot.availableActions.canApprove || !allConfirmationsChecked || !approvalNote.trim() || Boolean(mutation)} onClick={() => void approvePilot(activePilot)} className="w-full bg-cyan-200 text-[#061012] hover:bg-cyan-100">
                          {mutation?.action === "approval" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />} Approve exact pilot
                        </Button>
                      </>
                    )}

                    <div className="rounded-lg border border-white/10 p-3 text-xs leading-5 text-zinc-300">
                      <p className="font-semibold">Saved email format: {activePilot.contentMode === "approved_design_v2" ? "Approved v2 design with inline artwork" : activePilot.contentMode === "preference_buttons" ? "Preference buttons (no artwork)" : activePilot.contentMode === "plain_text" ? "Plain text" : "Email with artwork"}</p>
                      {activePilot.contentMode === "approved_design_v2" && activePilot.emailPreview && (
                        <details className="mt-2">
                          <summary className="cursor-pointer">Review approved design and recipient greeting</summary>
                          <p className="mt-2 font-semibold">Subject: {activePilot.emailPreview.subject}</p>
                          <p>Preview for {activePilot.emailPreview.greetingName}. Links are inactive; delivery creates each recipient&apos;s own links.</p>
                          <iframe title="Approved campaign email preview" srcDoc={activePilot.emailPreview.html} sandbox="" referrerPolicy="no-referrer" className="mt-3 h-[820px] w-full rounded border border-white/10 bg-white" />
                          <details className="mt-2"><summary className="cursor-pointer">Plain-text alternative</summary><pre className="mt-2 whitespace-pre-wrap font-sans">{activePilot.emailPreview.plainText}</pre></details>
                          <p className="mt-2">Reviewed greetings: {activePilot.recipients.map((recipient) => recipient.greetingName).join(", ")}</p>
                        </details>
                      )}
                      {!hasArtwork(activePilot.contentMode) && campaign && campaign.review.previewFingerprint === activePilot.campaignPreviewFingerprint && (
                        <details className="mt-2">
                          <summary className="cursor-pointer">Review saved invitation and footer</summary>
                          <p className="mt-2 font-semibold">Subject: {campaign.copy.subject}</p>
                          <pre className="mt-2 whitespace-pre-wrap font-sans">{campaign.copy.plainText}</pre>
                          <p className="mt-3">{activePilot.sender.legalEntity}</p>
                          <p className="whitespace-pre-wrap">{activePilot.sender.physicalPostalAddress}</p>
                          <p className="mt-2">From: {activePilot.sender.fromEmail} · Reply to: {activePilot.sender.replyTo}</p>
                          <p>The final email includes each recipient&apos;s preference and unsubscribe links. Preference buttons require confirmation on the page. Rosser Gallery: https://rossergallery.com · RT.Solutions: https://rt.solutions</p>
                        </details>
                      )}
                    </div>

                    {activePilot.approval && (
                      <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.07] p-3 text-xs leading-5 text-emerald-100">
                        Approved until {new Date(activePilot.approval.expiresAt).toLocaleString()}. Any material drift returns this pilot to review.
                      </div>
                    )}

                    <Button type="button" disabled={!activePilot.availableActions.canLaunch || !activePilot.approval || Boolean(mutation)} onClick={() => void launchPilot(activePilot)} className="w-full bg-emerald-300 text-emerald-950 hover:bg-emerald-200">
                      {mutation?.action === "launch" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MailCheck aria-hidden="true" />} Authorize exact five-email launch · {providerLaunchLabel}
                    </Button>
                    <input aria-label="Stop reason" value={stopReason} onChange={(event) => setStopReason(event.target.value)} placeholder="Reason to stop this pilot" className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-red-200/50" />
                    <Button type="button" variant="outline" disabled={!activePilot.availableActions.canStop || !stopReason.trim() || Boolean(mutation)} onClick={() => void stopPilot(activePilot)} className="w-full border-red-300/25 bg-red-300/[0.04] text-red-100 hover:bg-red-300/10 hover:text-red-50">
                      <CircleStop aria-hidden="true" /> Stop pilot
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-white/15 p-3 text-xs text-zinc-500">
                  No pilot exists. Approval and launch have zero authority.
                </p>
              )}
            </div>
          </div>
        </article>
      </div>

      <footer className="border-t border-white/10 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs leading-5 text-zinc-400">
            {error ? (
              <p className="flex items-start gap-2 break-words text-red-200" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error} — no approval or launch authority was granted.</p>
            ) : loading ? (
              <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking live activation controls…</p>
            ) : (
              <p>{activation ? `${activation.candidateSummary.returned} candidates returned · ${activation.candidateSummary.excluded} excluded · provider actions: none.` : "No activation contract loaded."}</p>
            )}
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={loading || Boolean(mutation)} onClick={refreshConnectionStatus} className="self-start text-zinc-300 hover:bg-white/10 hover:text-white sm:self-auto">
            <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh controls
          </Button>
        </div>
      </footer>
    </section>
  );
}
