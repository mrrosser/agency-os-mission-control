"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Activity, AlertCircle, Terminal, CheckCircle2, Bookmark, Save, Trash2, RefreshCcw, Pause, Play, Clock3, Bug, ShieldCheck, HardDrive, ArrowUpRight, Download } from "lucide-react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { useAuth } from "@/components/providers/auth-provider";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { KnowledgeBase } from "@/components/operations/KnowledgeBase";
import { ScriptGenerator } from "@/lib/ai/script-generator";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { dbService } from "@/lib/db-service";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";
import { LeadJourney, type LeadJourneyEntry, type LeadJourneyStepKey } from "@/components/operations/LeadJourney";
import { RunDiagnostics, type LeadRunDiagnostics } from "@/components/operations/RunDiagnostics";
import { LeadReceiptDrawer, type LeadReceiptLeadView } from "@/components/operations/LeadReceiptDrawer";
import { RunAuditDrawer } from "@/components/operations/RunAuditDrawer";
import type { LeadCandidate, LeadSourceRequest } from "@/lib/leads/types";
import { buildLeadActionIdempotencyKey, buildLeadDocId } from "@/lib/lead-runs/ids";
import { leadsToCsv } from "@/lib/leads/export";

interface LeadContext {
    companyName: string;
    founderName?: string;
    email?: string;
    phone?: string;
    targetIndustry?: string;
}

interface DriveCreateFolderResponse {
    success?: boolean;
    replayed?: boolean;
    dryRun?: boolean;
    mainFolder?: {
        id?: string;
        name?: string;
        webViewLink?: string;
    };
    subfolders?: Record<string, { id?: string; name?: string }>;
    error?: string;
}

interface CalendarScheduleResponse {
    success?: boolean;
    scheduledStart?: string;
    scheduledEnd?: string;
    meetLink?: string;
    event?: {
        id?: string;
        htmlLink?: string;
        conferenceData?: {
            entryPoints?: Array<{ uri?: string }>;
        };
    };
    replayed?: boolean;
    dryRun?: boolean;
    checked?: number;
    busyCount?: number;
    error?: string;
}

interface GmailDraftResponse {
    success?: boolean;
    draftId?: string;
    messageId?: string;
    threadId?: string;
    replayed?: boolean;
    dryRun?: boolean;
    error?: string;
}

interface LeadRunTemplate {
    templateId: string;
    name: string;
    clientName?: string | null;
    params: LeadSourceRequest;
    outreach?: {
        businessKey?: "aicf" | "rng" | "rts" | "rt";
        useSMS?: boolean;
        useAvatar?: boolean;
        useOutboundCall?: boolean;
        draftFirst?: boolean;
    };
}

interface DriveDeltaScanSummary {
    lastCheckpoint: string | null;
    lastRunAt: string | null;
    lastResultCount: number;
    staleDays: number | null;
    folderIds: string[];
    maxFiles: number;
}

interface LeadReceiptAction {
    actionId?: string;
    status?: "complete" | "error" | "skipped" | "simulated";
    dryRun?: boolean;
    replayed?: boolean;
    correlationId?: string;
    createdAt?: string;
    updatedAt?: string;
    data?: Record<string, unknown>;
}

interface LeadReceiptEntry extends LeadCandidate {
    leadDocId: string;
    actions?: LeadReceiptAction[];
}

interface LeadRunReceiptsResponse {
    run?: {
        runId?: string;
        createdAt?: string;
        warnings?: string[];
        candidateTotal?: number;
        filteredOut?: number;
        total?: number;
        request?: LeadSourceRequest;
    };
    leads?: LeadReceiptEntry[];
}

interface TelemetryGroupSummary {
    fingerprint: string;
    kind: string;
    count: number;
    triage?: {
        status?: string;
        issueNumber?: number | null;
        issueUrl?: string | null;
        updatedAt?: string | null;
    };
    sample?: {
        message?: string;
        route?: string;
        correlationId?: string;
    };
}

interface LeadRunQuotaSummary {
    orgId: string;
    windowKey: string;
    runsUsed: number;
    leadsUsed: number;
    activeRuns: number;
    maxRunsPerDay: number;
    maxLeadsPerDay: number;
    maxActiveRuns: number;
    runsRemaining: number;
    leadsRemaining: number;
    utilization: {
        runsPct: number;
        leadsPct: number;
    };
}

interface LeadRunAlert {
    alertId: string;
    runId: string;
    severity: string;
    title: string;
    message: string;
    failureStreak: number;
    status: "open" | "acked";
    acknowledgedBy?: string | null;
    acknowledgedAt?: string | null;
    escalatedAt?: string | null;
    createdAt?: string | null;
}

interface LeadRunJob {
    runId: string;
    status: "queued" | "running" | "paused" | "completed" | "failed";
    nextIndex: number;
    totalLeads: number;
    createdAt?: string | null;
    updatedAt?: string | null;
    leaseUntil?: string | null;
    queueLagSeconds?: number | null;
    diagnostics: {
        sourceFetched?: number;
        sourceScored?: number;
        sourceFilteredByScore?: number;
        sourceWithEmail?: number;
        sourceWithoutEmail?: number;
        processedLeads?: number;
        failedLeads?: number;
        calendarRetries?: number;
        noEmail?: number;
        noSlot?: number;
        meetingsScheduled?: number;
        meetingsDrafted?: number;
        emailsSent?: number;
        emailsDrafted?: number;
        smsSent?: number;
        callsPlaced?: number;
        avatarsQueued?: number;
        channelFailures?: number;
    };
    lastError?: string | null;
}

type ApiErrorIssue = { path?: Array<string | number>; message?: string };
type ApiErrorDetails = { issues?: ApiErrorIssue[] };

const TEMPLATE_NAME_MAX = 120;
const TEMPLATE_CLIENT_NAME_MAX = 120;

function formatApiIssues(details?: ApiErrorDetails): string | null {
    const first = details?.issues?.[0];
    if (!first || !first.message) return null;
    const path = Array.isArray(first.path) ? first.path.filter(Boolean).join(".") : "";
    return path ? `${path}: ${first.message}` : first.message;
}

function statusFromActions(
    actions: LeadReceiptAction[] | undefined,
    actionPrefixes: string[],
    fallback: LeadJourneyEntry["steps"][LeadJourneyStepKey]
): LeadJourneyEntry["steps"][LeadJourneyStepKey] {
    const hits = (actions || []).filter((action) =>
        actionPrefixes.some((prefix) => (action.actionId || "").startsWith(prefix))
    );
    if (hits.length === 0) return fallback;
    if (hits.some((a) => a.status === "error")) return "error";
    if (hits.some((a) => a.status === "complete" || a.status === "simulated")) return "complete";
    if (hits.some((a) => a.status === "skipped")) return "skipped";
    return "pending";
}

function mapReceiptLeadToJourney(lead: LeadReceiptEntry): LeadJourneyEntry {
    const actions = lead.actions || [];
    return {
        leadId: lead.leadDocId || lead.id,
        companyName: lead.companyName,
        founderName: lead.founderName,
        score: lead.score || 0,
        source: lead.source,
        website: lead.website,
        googleMapsUrl: lead.googleMapsUrl,
        websiteDomain: lead.websiteDomain,
        domainClusterSize: lead.domainClusterSize,
        placePhotos: lead.placePhotos,
        steps: {
            source: "complete",
            score: "complete",
            enrich: lead.enriched ? "complete" : "skipped",
            script: statusFromActions(actions, ["heygen.", "elevenlabs."], "skipped"),
            outreach: statusFromActions(actions, ["gmail.outreach", "gmail.outreach_draft"], "pending"),
            followup: statusFromActions(actions, ["twilio.", "heygen."], "skipped"),
            booking: statusFromActions(actions, ["calendar.booking", "gmail.availability_draft"], "pending"),
        },
    };
}

export default function OperationsPage() {
    const { user } = useAuth();
    const [isRunning, setIsRunning] = useState(false);
    const isRunningRef = useRef(false); // Ref for loop control

    // Sync ref with state
    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    const [logs, setLogs] = useState<string[]>([]);
    const { status: secretStatus } = useSecretsStatus();
    const [limit, setLimit] = useState(10);
    const [minScore, setMinScore] = useState(55);
    const [leadQuery, setLeadQuery] = useState("");
    const [targetIndustry, setTargetIndustry] = useState("");
    const [targetLocation, setTargetLocation] = useState("");
    const [useSMS, setUseSMS] = useState(false);
    const [useAvatar, setUseAvatar] = useState(false);
    const [useOutboundCall, setUseOutboundCall] = useState(false); // NEW: Real phone call
    const [businessKey, setBusinessKey] = useState<"aicf" | "rng" | "rts">("aicf");
    const [draftFirst, setDraftFirst] = useState(false);
    const [dryRun, setDryRun] = useState(false);
    const [journeys, setJourneys] = useState<LeadJourneyEntry[]>([]);
    const [receiptLeads, setReceiptLeads] = useState<LeadReceiptLeadView[]>([]);
    const [receiptRunMeta, setReceiptRunMeta] = useState<NonNullable<LeadRunReceiptsResponse["run"]> | null>(null);
    const [auditOpen, setAuditOpen] = useState(false);
    const [selectedReceiptLeadId, setSelectedReceiptLeadId] = useState<string | null>(null);
    const [telemetryGroups, setTelemetryGroups] = useState<TelemetryGroupSummary[]>([]);
    const [loadingTelemetry, setLoadingTelemetry] = useState(false);
    const [quotaSummary, setQuotaSummary] = useState<LeadRunQuotaSummary | null>(null);
    const [alerts, setAlerts] = useState<LeadRunAlert[]>([]);
    const [loadingQuota, setLoadingQuota] = useState(false);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [acknowledgingAlertId, setAcknowledgingAlertId] = useState<string | null>(null);
    const [sourceRunId, setSourceRunId] = useState<string | null>(null);
    const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
    const [diagnostics, setDiagnostics] = useState<LeadRunDiagnostics>({});
    const [templates, setTemplates] = useState<LeadRunTemplate[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templateSaving, setTemplateSaving] = useState(false);
    const [templateDeleting, setTemplateDeleting] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
    const [templateName, setTemplateName] = useState("");
    const [templateClientName, setTemplateClientName] = useState("");
    const [loadingReceipts, setLoadingReceipts] = useState(false);
    const [receiptRunIdInput, setReceiptRunIdInput] = useState("");
    const [backgroundJob, setBackgroundJob] = useState<LeadRunJob | null>(null);
    const [startingBackgroundRun, setStartingBackgroundRun] = useState(false);
    const [jobActionLoading, setJobActionLoading] = useState(false);
    const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
    const [googleConnected, setGoogleConnected] = useState<boolean>(false);
    const [driveDelta, setDriveDelta] = useState<DriveDeltaScanSummary | null>(null);
    const [driveDeltaLoading, setDriveDeltaLoading] = useState(false);
    const [driveDeltaRunning, setDriveDeltaRunning] = useState(false);

    const hasTwilio =
        secretStatus.twilioSid !== "missing" &&
        secretStatus.twilioToken !== "missing";
    const hasElevenLabs = secretStatus.elevenLabsKey !== "missing";
    const hasHeyGen = secretStatus.heyGenKey !== "missing";
    const hasGooglePlaces = secretStatus.googlePlacesKey !== "missing";
    const hasFirecrawl = secretStatus.firecrawlKey !== "missing";

    const addLog = (message: string) => {
        setLogs(prev => [message, ...prev]);
    };

    const exportReceiptsCsv = () => {
        if (receiptLeads.length === 0) {
            toast.error("No leads loaded to export");
            return;
        }

        const csv = leadsToCsv(receiptLeads);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const runToken = (sourceRunId || receiptRunIdInput || "lead-run").trim().slice(0, 12);
        a.href = url;
        a.download = `lead-run-${runToken}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("Exported CSV");
    };

    const loadGoogleConnectionStatus = async () => {
        if (!user) return;
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/google/status", { method: "GET", headers });
            const data = await readApiJson<{ connected?: boolean; error?: string }>(res);
            if (!res.ok) {
                throw new Error(data?.error || "Failed to load Google connection status");
            }
            setGoogleConnected(Boolean(data?.connected));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reportClientError(message, { source: "operations.google_status" });
        }
    };

    const loadDriveDeltaStatus = async () => {
        if (!user) return;
        setDriveDeltaLoading(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/drive/delta-scan", { method: "GET", headers });
            const data = await readApiJson<{ summary?: DriveDeltaScanSummary; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error || `Failed to load Drive delta status${cid ? ` cid=${cid}` : ""}`
                );
            }
            setDriveDelta(data.summary || null);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reportClientError(message, { source: "operations.drive_delta_status" });
        } finally {
            setDriveDeltaLoading(false);
        }
    };

    const runDriveDeltaScan = async () => {
        if (!user) return;
        setDriveDeltaRunning(true);
        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const res = await fetch("/api/drive/delta-scan", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    maxFiles: 200,
                    dryRun: false,
                }),
            });
            const data = await readApiJson<{ summary?: DriveDeltaScanSummary; scannedCount?: number; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error || `Drive delta scan failed${cid ? ` cid=${cid}` : ""}`
                );
            }
            setDriveDelta(data.summary || null);
            toast.success("Drive delta scan complete", {
                description: `${data.scannedCount || 0} modified files captured.`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error("Drive delta scan failed", { description: message });
            reportClientError(message, { source: "operations.drive_delta_run" });
        } finally {
            setDriveDeltaRunning(false);
        }
    };

    const loadTemplates = async () => {
        if (!user) return;
        setTemplatesLoading(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/leads/templates", { method: "GET", headers });
            const data = await readApiJson<{ templates?: LeadRunTemplate[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load templates (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setTemplates(Array.isArray(data.templates) ? data.templates : []);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error("Could not load saved lead templates", { description: message });
        } finally {
            setTemplatesLoading(false);
        }
    };

    useEffect(() => {
        if (!user) {
            setTemplates([]);
            setSelectedTemplateId("");
            setBackgroundJob(null);
            setReceiptLeads([]);
            setReceiptRunMeta(null);
            setAuditOpen(false);
            setSelectedReceiptLeadId(null);
            setTelemetryGroups([]);
            setQuotaSummary(null);
            setAlerts([]);
            setGoogleConnected(false);
            setDriveDelta(null);
            return;
        }
        void loadTemplates();
        void loadQuotaSummary();
        void loadAlerts();
        void loadGoogleConnectionStatus();
        void loadDriveDeltaStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    const reportClientError = (message: string, meta?: Record<string, unknown>) => {
        try {
            const reporter = (window as unknown as {
                __mcReportTelemetryError?: (input: {
                    kind: "client" | "react";
                    message: string;
                    name?: string;
                    stack?: string;
                    route?: string;
                    correlationId?: string;
                    meta?: Record<string, unknown>;
                }) => void;
            }).__mcReportTelemetryError;
            reporter?.({
                kind: "client",
                message,
                route: window.location.pathname,
                correlationId: sourceRunId || undefined,
                meta: {
                    runId: sourceRunId || null,
                    ...meta,
                },
            });
        } catch {
            // Best-effort telemetry only.
        }
    };

    const loadTelemetryGroups = async (runId: string) => {
        if (!user) return;
        const normalizedRunId = runId.trim();
        if (!normalizedRunId) return;

        setLoadingTelemetry(true);
        try {
            const headers = await buildAuthHeaders(user, {
                correlationId: normalizedRunId,
            });
            const res = await fetch(`/api/telemetry/groups?runId=${encodeURIComponent(normalizedRunId)}&limit=6`, {
                method: "GET",
                headers,
            });
            const data = await readApiJson<{ groups?: TelemetryGroupSummary[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load telemetry groups (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setTelemetryGroups(Array.isArray(data.groups) ? data.groups : []);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            reportClientError(message, { source: "operations.load_telemetry_groups", runId: normalizedRunId });
        } finally {
            setLoadingTelemetry(false);
        }
    };

    const loadQuotaSummary = async () => {
        if (!user) return;
        setLoadingQuota(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/lead-runs/quota", {
                method: "GET",
                headers,
            });
            const data = await readApiJson<{ quota?: LeadRunQuotaSummary; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load quota (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setQuotaSummary(data.quota || null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            reportClientError(message, { source: "operations.load_quota" });
        } finally {
            setLoadingQuota(false);
        }
    };

    const loadAlerts = async () => {
        if (!user) return;
        setLoadingAlerts(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/lead-runs/alerts?limit=10", {
                method: "GET",
                headers,
            });
            const data = await readApiJson<{ alerts?: LeadRunAlert[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load alerts (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            reportClientError(message, { source: "operations.load_alerts" });
        } finally {
            setLoadingAlerts(false);
        }
    };

    const acknowledgeAlert = async (alertId: string) => {
        if (!user) return;
        setAcknowledgingAlertId(alertId);
        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const res = await fetch("/api/lead-runs/alerts", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    action: "acknowledge",
                    alertId,
                }),
            });
            const data = await readApiJson<{ ok?: boolean; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to acknowledge alert (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setAlerts((prev) =>
                prev.map((alert) =>
                    alert.alertId === alertId
                        ? {
                            ...alert,
                            status: "acked",
                            acknowledgedAt: new Date().toISOString(),
                          }
                        : alert
                )
            );
            toast.success("Alert acknowledged");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error("Could not acknowledge alert", { description: message });
            reportClientError(message, { source: "operations.acknowledge_alert", alertId });
        } finally {
            setAcknowledgingAlertId(null);
        }
    };

    const loadRunReceipts = async (runId: string) => {
        if (!user) return;
        const normalizedRunId = runId.trim();
        if (!normalizedRunId) return;

        setLoadingReceipts(true);
        try {
            const headers = await buildAuthHeaders(user, {
                correlationId: normalizedRunId,
            });
            const res = await fetch(`/api/lead-runs/${normalizedRunId}/receipts`, {
                method: "GET",
                headers,
            });
            const data = await readApiJson<LeadRunReceiptsResponse & { error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load receipts (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }

            const leads = Array.isArray(data.leads) ? data.leads : [];
            setJourneys(leads.map(mapReceiptLeadToJourney));
            setReceiptLeads(leads);
            setReceiptRunMeta(data.run || null);
            setSelectedReceiptLeadId((prev) => {
                if (!prev) return prev;
                const stillExists = leads.some((lead) => lead.leadDocId === prev || lead.id === prev);
                return stillExists ? prev : null;
            });
            setSourceRunId(normalizedRunId);
            setReceiptRunIdInput(normalizedRunId);
            setSourceWarnings(Array.isArray(data.run?.warnings) ? data.run?.warnings : []);

            setDiagnostics((prev) => ({
                ...prev,
                runId: normalizedRunId,
                candidateTotal: typeof data.run?.candidateTotal === "number" ? data.run.candidateTotal : prev.candidateTotal,
                filteredOut: typeof data.run?.filteredOut === "number" ? data.run.filteredOut : prev.filteredOut,
                scoredCount: typeof data.run?.total === "number" ? data.run.total : leads.length,
                processed: leads.length,
            }));

            localStorage.setItem("mission_control_last_run_id", normalizedRunId);
            void loadTelemetryGroups(normalizedRunId);
            void loadQuotaSummary();
            void loadAlerts();
            toast.success(`Loaded receipts for run ${normalizedRunId.slice(0, 8)}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setLastErrorMessage(message);
            toast.error("Could not load run receipts", { description: message });
            reportClientError(message, { source: "operations.load_receipts" });
        } finally {
            setLoadingReceipts(false);
        }
    };

    useEffect(() => {
        if (!user) return;
        const stored = localStorage.getItem("mission_control_last_run_id");
        if (stored) {
            setReceiptRunIdInput(stored);
            void loadRunReceipts(stored);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    const applyTemplate = (template: LeadRunTemplate) => {
        const p = template.params || {};
        setLeadQuery(p.query || "");
        setTargetIndustry(p.industry || "");
        setTargetLocation(p.location || "");
        if (typeof p.limit === "number" && Number.isFinite(p.limit)) setLimit(p.limit);
        if (typeof p.minScore === "number" && Number.isFinite(p.minScore)) setMinScore(p.minScore);

        const outreach = template.outreach || {};
        const templateBusinessKey = outreach.businessKey;
        if (templateBusinessKey === "aicf" || templateBusinessKey === "rng" || templateBusinessKey === "rts") {
            setBusinessKey(templateBusinessKey);
        } else if (templateBusinessKey === "rt") {
            setBusinessKey("rts");
        }
        const wantsSMS = Boolean(outreach.useSMS);
        const wantsCall = Boolean(outreach.useOutboundCall);
        const wantsAvatar = Boolean(outreach.useAvatar);
        const wantsDraftFirst = Boolean(outreach.draftFirst);

        if (wantsSMS && !hasTwilio) {
            toast.warning("Template requested SMS, but Twilio config is incomplete.", {
                description: "Set SID, token, and phone number in Settings. SMS has been disabled for this run.",
            });
        }
        if (wantsCall && !(hasTwilio && hasElevenLabs)) {
            toast.warning("Template requested outbound calls, but required keys are missing.", {
                description: "Set Twilio SID/token/phone and ElevenLabs key. Outbound calls have been disabled for this run.",
            });
        }
        if (wantsAvatar && !hasHeyGen) {
            toast.warning("Template requested avatar video, but HeyGen key is missing.", {
                description: "Avatar video has been disabled for this run.",
            });
        }

        setUseSMS(wantsSMS && hasTwilio);
        setUseOutboundCall(wantsCall && hasTwilio && hasElevenLabs);
        setUseAvatar(wantsAvatar && hasHeyGen);
        setDraftFirst(wantsDraftFirst);
    };

    const onSelectTemplate = (templateId: string) => {
        setSelectedTemplateId(templateId);
        const template = templates.find((t) => t.templateId === templateId);
        if (!template) return;
        setTemplateName(template.name);
        setTemplateClientName(template.clientName || "");
        applyTemplate(template);
        toast.success(`Loaded template: ${template.name}`);
    };

    const clearTemplateSelection = () => {
        setSelectedTemplateId("");
    };

    const openTemplateDialog = () => {
        const selected = templates.find((t) => t.templateId === selectedTemplateId);
        const suggestedName = (selected?.name || templateName || leadQuery || targetIndustry || "Lead Run").trim();
        // Avoid server-side validation failures by keeping suggestions within the API limit.
        const cappedName =
            suggestedName.length > TEMPLATE_NAME_MAX
                ? suggestedName.slice(0, TEMPLATE_NAME_MAX).trimEnd()
                : suggestedName;
        setTemplateName(cappedName);
        setTemplateClientName((selected?.clientName || templateClientName || "").trim());
        setTemplateDialogOpen(true);
    };

    const saveTemplate = async () => {
        if (!user) return;
        const name = templateName.trim();
        if (!name) {
            toast.error("Template name is required");
            return;
        }
        if (name.length > TEMPLATE_NAME_MAX) {
            toast.error(`Template name must be ${TEMPLATE_NAME_MAX} characters or fewer`);
            return;
        }

        const clientName = templateClientName.trim();
        if (clientName.length > TEMPLATE_CLIENT_NAME_MAX) {
            toast.error(`Client/Org label must be ${TEMPLATE_CLIENT_NAME_MAX} characters or fewer`);
            return;
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
            toast.error("Lead Limit must be an integer between 1 and 25");
            return;
        }
        if (!Number.isInteger(minScore) || minScore < 0 || minScore > 100) {
            toast.error("Minimum Score must be an integer between 0 and 100");
            return;
        }

        setTemplateSaving(true);
        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });

            const res = await fetch("/api/leads/templates", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    templateId: selectedTemplateId || undefined,
                    name,
                    clientName: clientName || undefined,
                    params: {
                        query: leadQuery.trim() || undefined,
                        industry: targetIndustry.trim() || undefined,
                        location: targetLocation.trim() || undefined,
                        limit,
                        minScore,
                    },
                    outreach: {
                        businessKey,
                        useSMS,
                        useAvatar,
                        useOutboundCall,
                        draftFirst,
                    },
                }),
            });

            const data = await readApiJson<{
                template?: LeadRunTemplate;
                error?: string;
                details?: ApiErrorDetails;
            }>(res);
            if (!res.ok || !data.template) {
                const cid = getResponseCorrelationId(res);
                const issues = formatApiIssues(data.details);
                const baseMessage =
                    data?.error ||
                    `Failed to save template (status ${res.status}${cid ? ` cid=${cid}` : ""})`;
                const message = issues ? `${baseMessage} (${issues})` : baseMessage;
                throw new Error(
                    message
                );
            }

            setSelectedTemplateId(data.template.templateId);
            setTemplateDialogOpen(false);
            toast.success("Template saved");
            await loadTemplates();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error("Could not save template", { description: message });
        } finally {
            setTemplateSaving(false);
        }
    };

    const deleteSelectedTemplate = async () => {
        if (!user || !selectedTemplateId) return;
        setTemplateDeleting(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch(`/api/leads/templates/${selectedTemplateId}`, {
                method: "DELETE",
                headers,
            });
            const data = await readApiJson<{ ok?: boolean; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to delete template (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setTemplates((prev) => prev.filter((t) => t.templateId !== selectedTemplateId));
            setSelectedTemplateId("");
            toast.success("Template deleted");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error("Could not delete template", { description: message });
        } finally {
            setTemplateDeleting(false);
        }
    };

    const updateJourneyStep = (leadId: string, step: LeadJourneyStepKey, status: LeadJourneyEntry["steps"][LeadJourneyStepKey]) => {
        setJourneys(prev =>
            prev.map(entry =>
                entry.leadId === leadId
                    ? { ...entry, steps: { ...entry.steps, [step]: status } }
                    : entry
            )
        );
    };
    const stopCampaign = () => {
        setIsRunning(false);
        addLog("\n🛑 Lead run stopped by user.");
    };

    const refreshBackgroundJob = async (runId: string) => {
        if (!user) return;
        try {
            const headers = await buildAuthHeaders(user, {
                correlationId: runId,
            });
            const res = await fetch(`/api/lead-runs/${runId}/jobs`, {
                method: "GET",
                headers,
            });
            const data = await readApiJson<{ job?: LeadRunJob | null; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load background job (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setBackgroundJob(data.job || null);
            if (data.job) {
                setDiagnostics((prev) => ({
                    ...prev,
                    candidateTotal: data.job?.diagnostics?.sourceFetched ?? prev.candidateTotal ?? 0,
                    scoredCount: data.job?.diagnostics?.sourceScored ?? prev.scoredCount ?? 0,
                    filteredOut:
                        data.job?.diagnostics?.sourceFilteredByScore ??
                        prev.filteredOut ??
                        0,
                    sourceWithEmail: data.job?.diagnostics?.sourceWithEmail ?? prev.sourceWithEmail ?? 0,
                    sourceWithoutEmail: data.job?.diagnostics?.sourceWithoutEmail ?? prev.sourceWithoutEmail ?? 0,
                    queueLagSeconds: data.job?.queueLagSeconds ?? prev.queueLagSeconds ?? 0,
                    processed: data.job?.diagnostics?.processedLeads || prev.processed || 0,
                    failedLeads: data.job?.diagnostics?.failedLeads || prev.failedLeads || 0,
                    calendarRetries:
                        data.job?.diagnostics?.calendarRetries || prev.calendarRetries || 0,
                    meetingsScheduled: data.job?.diagnostics?.meetingsScheduled || prev.meetingsScheduled || 0,
                    meetingsDrafted: data.job?.diagnostics?.meetingsDrafted || prev.meetingsDrafted || 0,
                    emailsSent: data.job?.diagnostics?.emailsSent || prev.emailsSent || 0,
                    emailsDrafted: data.job?.diagnostics?.emailsDrafted || prev.emailsDrafted || 0,
                    noEmail: data.job?.diagnostics?.noEmail || prev.noEmail || 0,
                    noSlot: data.job?.diagnostics?.noSlot || prev.noSlot || 0,
                    smsSent: data.job?.diagnostics?.smsSent || prev.smsSent || 0,
                    callsPlaced: data.job?.diagnostics?.callsPlaced || prev.callsPlaced || 0,
                    avatarsQueued: data.job?.diagnostics?.avatarsQueued || prev.avatarsQueued || 0,
                    channelFailures: data.job?.diagnostics?.channelFailures || prev.channelFailures || 0,
                }));
                if (data.job.status === "completed" || data.job.status === "failed") {
                    void loadQuotaSummary();
                    void loadAlerts();
                }
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setLastErrorMessage(message);
            reportClientError(message, { source: "operations.refresh_background_job", runId });
        }
    };

    const controlBackgroundJob = async (action: "pause" | "resume") => {
        if (!user || !sourceRunId) return;
        setJobActionLoading(true);
        try {
            const headers = await buildAuthHeaders(user, {
                correlationId: sourceRunId,
            });
            const res = await fetch(`/api/lead-runs/${sourceRunId}/jobs`, {
                method: "POST",
                headers,
                body: JSON.stringify({ action }),
            });
            const data = await readApiJson<{ job?: LeadRunJob; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to ${action} background run (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setBackgroundJob(data.job || null);
            toast.success(action === "pause" ? "Background run paused" : "Background run resumed");
            void loadAlerts();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setLastErrorMessage(message);
            toast.error(`Could not ${action} background run`, { description: message });
            reportClientError(message, { source: "operations.control_background_job", action });
        } finally {
            setJobActionLoading(false);
        }
    };

    const startBackgroundRun = async () => {
        if (!user) {
            toast.error("You must be logged in to run lead sourcing");
            return;
        }
        if (!leadQuery && !targetIndustry) {
            toast.error("Add a lead query or target industry to source leads");
            return;
        }

        const runId = crypto.randomUUID();
        const correlationId = runId;
        setStartingBackgroundRun(true);
        setLogs([]);
        setJourneys([]);
        setReceiptLeads([]);
        setReceiptRunMeta(null);
        setAuditOpen(false);
        setSelectedReceiptLeadId(null);
        setTelemetryGroups([]);
        setSourceRunId(runId);
        setReceiptRunIdInput(runId);
        setSourceWarnings([]);
        setBackgroundJob(null);
        setLastErrorMessage(null);
        setDiagnostics({
            runId,
            dryRun,
            candidateTotal: null,
            scoredCount: null,
            filteredOut: null,
            sourceWithEmail: 0,
            sourceWithoutEmail: 0,
            processed: 0,
            failedLeads: 0,
            queueLagSeconds: 0,
            calendarRetries: 0,
            meetingsScheduled: 0,
            meetingsDrafted: 0,
            noSlot: 0,
            emailsSent: 0,
            emailsDrafted: 0,
            noEmail: 0,
            smsSent: 0,
            callsPlaced: 0,
            avatarsQueued: 0,
            channelFailures: 0,
        });

        try {
            addLog(`🔍 Sourcing ${limit} leads for ${targetIndustry || "your ICP"}...`);
            const sourceHeaders = await buildAuthHeaders(user, {
                idempotencyKey: runId,
                correlationId,
            });
            const sourceResponse = await fetch("/api/leads/source", {
                method: "POST",
                headers: sourceHeaders,
                body: JSON.stringify({
                    query: leadQuery.trim() || undefined,
                    industry: targetIndustry.trim() || undefined,
                    location: targetLocation.trim() || undefined,
                    limit,
                    minScore,
                    includeEnrichment: true,
                }),
            });

            const sourceJson = await readApiJson<{
                runId?: string;
                leads?: LeadCandidate[];
                warnings?: string[];
                candidateTotal?: number;
                filteredOut?: number;
                sourceDiagnostics?: {
                    withEmail?: number;
                    withoutEmail?: number;
                    fetchedTotal?: number;
                    dedupedTotal?: number;
                    duplicatesRemoved?: number;
                    domainClusters?: number;
                    maxDomainClusterSize?: number;
                    scoredTotal?: number;
                    filteredByScore?: number;
                };
                error?: string;
            }>(sourceResponse);

            if (!sourceResponse.ok) {
                const cid = getResponseCorrelationId(sourceResponse);
                throw new Error(
                    sourceJson?.error ||
                    `Lead sourcing failed (status ${sourceResponse.status}${cid ? ` cid=${cid}` : ""})`
                );
            }

            const sourcedLeads = Array.isArray(sourceJson.leads) ? sourceJson.leads : [];
            setSourceWarnings(Array.isArray(sourceJson.warnings) ? sourceJson.warnings : []);
            setJourneys(
                sourcedLeads.map((lead) => ({
                    leadId: lead.id,
                    companyName: lead.companyName,
                    founderName: lead.founderName,
                    score: lead.score || 0,
                    source: lead.source,
                    website: lead.website,
                    googleMapsUrl: lead.googleMapsUrl,
                    websiteDomain: lead.websiteDomain,
                    domainClusterSize: lead.domainClusterSize,
                    placePhotos: lead.placePhotos,
                    steps: {
                        source: "complete",
                        score: "complete",
                        enrich: lead.enriched ? "complete" : "skipped",
                        script: "pending",
                        outreach: "pending",
                        followup: "pending",
                        booking: "pending",
                    },
                }))
            );
            setDiagnostics((prev) => ({
                ...prev,
                candidateTotal:
                    sourceJson.sourceDiagnostics?.fetchedTotal ??
                    sourceJson.candidateTotal ??
                    sourcedLeads.length,
                filteredOut:
                    sourceJson.sourceDiagnostics?.filteredByScore ??
                    sourceJson.filteredOut ??
                    Math.max(
                        0,
                        (sourceJson.sourceDiagnostics?.dedupedTotal ?? sourceJson.candidateTotal ?? sourcedLeads.length) -
                            sourcedLeads.length
                    ),
                scoredCount: sourceJson.sourceDiagnostics?.scoredTotal ?? sourcedLeads.length,
                sourceWithEmail: sourceJson.sourceDiagnostics?.withEmail ?? 0,
                sourceWithoutEmail: sourceJson.sourceDiagnostics?.withoutEmail ?? 0,
            }));

            const jobHeaders = await buildAuthHeaders(user, {
                correlationId: runId,
                idempotencyKey: crypto.randomUUID(),
            });
            const jobResponse = await fetch(`/api/lead-runs/${runId}/jobs`, {
                method: "POST",
                headers: jobHeaders,
                body: JSON.stringify({
                    action: "start",
                    config: {
                        dryRun,
                        draftFirst,
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                        businessKey,
                        useSMS,
                        useAvatar,
                        useOutboundCall,
                    },
                }),
            });

            const jobJson = await readApiJson<{ job?: LeadRunJob; error?: string }>(jobResponse);
            if (!jobResponse.ok || !jobJson.job) {
                const cid = getResponseCorrelationId(jobResponse);
                throw new Error(
                    jobJson?.error ||
                    `Background start failed (status ${jobResponse.status}${cid ? ` cid=${cid}` : ""})`
                );
            }

            setBackgroundJob(jobJson.job);
            setDiagnostics((prev) => ({
                ...prev,
                queueLagSeconds: jobJson.job?.queueLagSeconds ?? prev.queueLagSeconds ?? 0,
                failedLeads: jobJson.job?.diagnostics?.failedLeads ?? prev.failedLeads ?? 0,
                calendarRetries:
                    jobJson.job?.diagnostics?.calendarRetries ?? prev.calendarRetries ?? 0,
            }));
            localStorage.setItem("mission_control_last_run_id", runId);
            addLog("✓ Background run started. Processing continues on the server.");
            toast.success("Background run started");
            void loadQuotaSummary();
            void loadAlerts();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setLastErrorMessage(message);
            addLog(`❌ Background run failed to start: ${message}`);
            toast.error("Could not start background run", { description: message });
            reportClientError(message, { source: "operations.start_background_run" });
        } finally {
            setStartingBackgroundRun(false);
        }
    };

    useEffect(() => {
        if (!user || !sourceRunId) return;
        if (!backgroundJob) return;
        if (!(backgroundJob.status === "queued" || backgroundJob.status === "running")) return;

        const interval = window.setInterval(() => {
            void refreshBackgroundJob(sourceRunId);
            void loadRunReceipts(sourceRunId);
        }, 5000);

        return () => window.clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, sourceRunId, backgroundJob?.status]);

    const handleRun = async () => {
        if (!user) {
            toast.error("You must be logged in to run lead sourcing");
            return;
        }
        if (!leadQuery && !targetIndustry) {
            toast.error("Add a lead query or target industry to source leads");
            return;
        }

        const runId = crypto.randomUUID();
        const correlationId = runId;

        setIsRunning(true);
        setLogs([]);
        setJourneys([]);
        setReceiptLeads([]);
        setReceiptRunMeta(null);
        setAuditOpen(false);
        setSelectedReceiptLeadId(null);
        setTelemetryGroups([]);
        setSourceRunId(runId);
        setReceiptRunIdInput(runId);
        setSourceWarnings([]);
        setBackgroundJob(null);
        setLastErrorMessage(null);
        setDiagnostics({
            runId,
            dryRun,
            candidateTotal: null,
            scoredCount: null,
            filteredOut: null,
            sourceWithEmail: 0,
            sourceWithoutEmail: 0,
            processed: 0,
            failedLeads: 0,
            queueLagSeconds: 0,
            calendarRetries: 0,
            meetingsScheduled: 0,
            meetingsDrafted: 0,
            noSlot: 0,
            emailsSent: 0,
            emailsDrafted: 0,
            noEmail: 0,
            smsSent: 0,
            callsPlaced: 0,
            avatarsQueued: 0,
            channelFailures: 0,
        });

        try {

            // Step 1: Load identity
            addLog("Loading business identity...");
            await new Promise(r => setTimeout(r, 500));

            const identityDoc = await getDoc(doc(db, "identities", user.uid));
            if (!identityDoc.exists()) {
                throw new Error("Please configure your business identity first");
            }

            const identity = identityDoc.data();
            addLog(`✓ Identity loaded: ${identity.businessName}`);

            // Step 2: Load Knowledge Base Context (ONCE)
            let context = "";
            const kbFiles = JSON.parse(localStorage.getItem("mission_control_knowledge_base") || "[]");
            if (kbFiles.length > 0) {
                addLog(`📚 Reading ${kbFiles.length} knowledge base files...`);
                try {
                    // For demo, just read first file to save tokens/time
                    // In production, we would merge all selected files or use a vector search
                    const readHeaders = await buildAuthHeaders(user, { correlationId });
                     const readResponse = await fetch('/api/drive/read', {
                         method: 'POST',
                         headers: readHeaders,
                         body: JSON.stringify({ fileId: kbFiles[0] })
                     });
                    const readResult = await readApiJson<{ success?: boolean; content?: string; name?: string; error?: string }>(readResponse);
                    if (readResponse.ok && readResult.success) {
                        context = readResult.content || "";
                        addLog(`✓ Context loaded from "${readResult.name || "Knowledge Base"}"`);
                    } else if (!readResponse.ok) {
                        const cid = getResponseCorrelationId(readResponse);
                        throw new Error(
                            readResult?.error ||
                            `Failed to read knowledge base (status ${readResponse.status}${cid ? ` cid=${cid}` : ""})`
                        );
                    }
                 } catch (e) {
                     console.error("Context load error", e);
                     addLog("⚠ Failed to load context, proceeding with generic scripts...");
                 }
            }

            // Step 3: Source + score leads
            addLog(`🔍 Sourcing ${limit} leads for ${targetIndustry || 'your ICP'}...`);

            const sourceHeaders = await buildAuthHeaders(user, {
                idempotencyKey: runId,
                correlationId,
            });
             const sourceResponse = await fetch("/api/leads/source", {
                 method: "POST",
                 headers: sourceHeaders,
                 body: JSON.stringify({
                     query: leadQuery || undefined,
                    industry: targetIndustry || undefined,
                    location: targetLocation || undefined,
                    limit,
                    minScore,
                    includeEnrichment: true,
                     sources: hasGooglePlaces ? ["googlePlaces"] : ["firestore"],
                 }),
             });
            const sourcePayload = await readApiJson<{
                leads?: LeadCandidate[];
                runId?: string;
                warnings?: string[];
                candidateTotal?: number;
                filteredOut?: number;
                sourceDiagnostics?: {
                    withEmail?: number;
                    withoutEmail?: number;
                    fetchedTotal?: number;
                    dedupedTotal?: number;
                    duplicatesRemoved?: number;
                    domainClusters?: number;
                    maxDomainClusterSize?: number;
                    scoredTotal?: number;
                    filteredByScore?: number;
                };
                error?: string;
            }>(sourceResponse);
            if (!sourceResponse.ok) {
                const cid = getResponseCorrelationId(sourceResponse);
                throw new Error(
                    sourcePayload?.error ||
                    `Lead sourcing failed (status ${sourceResponse.status}${cid ? ` cid=${cid}` : ""})`
                );
            }

             const sourcedLeads = (sourcePayload.leads || []) as LeadCandidate[];
            setSourceRunId(sourcePayload.runId || runId);
            setSourceWarnings(sourcePayload.warnings || []);

            if (sourcePayload.warnings?.length) {
                addLog(`⚠ ${sourcePayload.warnings.join(" ")}`);
            }

            if (sourcedLeads.length === 0) {
                throw new Error("No leads found. Adjust your query or add a Places key.");
            }

            if (
                typeof sourcePayload.candidateTotal === "number" ||
                typeof sourcePayload.sourceDiagnostics?.fetchedTotal === "number"
            ) {
                const filteredOut =
                    typeof sourcePayload.sourceDiagnostics?.filteredByScore === "number"
                        ? sourcePayload.sourceDiagnostics.filteredByScore
                        : typeof sourcePayload.filteredOut === "number"
                          ? sourcePayload.filteredOut
                          : null;
                const filteredMsg =
                    filteredOut && filteredOut > 0 ? ` (${filteredOut} filtered out below ${minScore})` : "";
                const fetchedTotal =
                    sourcePayload.sourceDiagnostics?.fetchedTotal ??
                    sourcePayload.candidateTotal ??
                    sourcedLeads.length;
                const dedupedTotal =
                    sourcePayload.sourceDiagnostics?.dedupedTotal ??
                    sourcedLeads.length;
                const duplicatesRemoved = sourcePayload.sourceDiagnostics?.duplicatesRemoved ?? 0;
                const domainClusters = sourcePayload.sourceDiagnostics?.domainClusters ?? 0;
                const domainMsg =
                    duplicatesRemoved > 0 || domainClusters > 0
                        ? ` (${duplicatesRemoved} dupes removed, ${domainClusters} domain clusters)`
                        : "";
                const withEmail = sourcePayload.sourceDiagnostics?.withEmail ?? 0;
                const withoutEmail = sourcePayload.sourceDiagnostics?.withoutEmail ?? 0;
                addLog(
                    `✓ Found ${fetchedTotal} candidates; ${dedupedTotal} after dedupe${domainMsg}; ${sourcedLeads.length} scored >= ${minScore}${filteredMsg} (${withEmail} with email, ${withoutEmail} without email)`
                );
                setDiagnostics((prev) => ({
                    ...prev,
                    candidateTotal: fetchedTotal,
                    scoredCount: sourcePayload.sourceDiagnostics?.scoredTotal ?? sourcedLeads.length,
                    filteredOut: filteredOut ?? null,
                    sourceWithEmail: withEmail,
                    sourceWithoutEmail: withoutEmail,
                }));
            } else {
                addLog(`✓ Scored ${sourcedLeads.length} leads above ${minScore}`);
                setDiagnostics((prev) => ({
                    ...prev,
                    candidateTotal: null,
                    scoredCount: sourcedLeads.length,
                    filteredOut: null,
                    sourceWithEmail: 0,
                    sourceWithoutEmail: 0,
                }));
            }

            setJourneys(
                sourcedLeads.map((lead) => ({
                    leadId: lead.id,
                    companyName: lead.companyName,
                    founderName: lead.founderName,
                    score: lead.score || 0,
                    source: lead.source,
                    website: lead.website,
                    googleMapsUrl: lead.googleMapsUrl,
                    websiteDomain: lead.websiteDomain,
                    domainClusterSize: lead.domainClusterSize,
                    steps: {
                        source: "complete",
                        score: "complete",
                        enrich: lead.enriched ? "complete" : "skipped",
                        script: "pending",
                        outreach: "pending",
                        followup: "pending",
                        booking: "pending",
                    },
                }))
            );

            // Step 4: Process each lead
            for (let i = 0; i < sourcedLeads.length; i++) {
                if (!isRunningRef.current) {
                    addLog("🛑 Loop aborted.");
                    break;
                }

                const lead = sourcedLeads[i];
                const leadDocId = buildLeadDocId({ source: lead.source, id: lead.id });
                setDiagnostics((prev) => ({ ...prev, processed: (prev.processed || 0) + 1 }));
                addLog(`\n--- Processing: ${lead.companyName} (${i + 1}/${sourcedLeads.length}) ---`);

                const leadName = lead.founderName || "there";
                const leadEmail = lead.email;
                const leadPhone = lead.phone;
                const needsScript = useOutboundCall || useAvatar;
                let scriptGenerated = false;
                let scriptErrored = false;
                if (!needsScript) {
                    updateJourneyStep(lead.id, "script", "skipped");
                }

                // Create Drive folder (idempotent per run+lead)
                addLog(`${dryRun ? "DRY RUN: " : ""}Creating Drive folder for ${lead.companyName}...`);
                const folderHeaders = await buildAuthHeaders(user, {
                    idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "drive.create-folder" }),
                    correlationId,
                });
                const folderResponse = await fetch("/api/drive/create-folder", {
                    method: "POST",
                    headers: folderHeaders,
                    body: JSON.stringify({
                        clientName: lead.companyName,
                        dryRun,
                        runId,
                        leadDocId,
                        receiptActionId: "drive.folder",
                    }),
                });
  
                let folderResult: DriveCreateFolderResponse | null = null;
                try {
                    folderResult = await readApiJson<DriveCreateFolderResponse>(folderResponse);
                    if (!folderResponse.ok) {
                        const cid = getResponseCorrelationId(folderResponse);
                        addLog(`⚠ Failed to create folder (status ${folderResponse.status}${cid ? ` cid=${cid}` : ""}), continuing...`);
                    } else {
                        addLog(`✓ Folder created with subfolders`);
                    }
                } catch (e) {
                    console.error("Folder create error", e);
                    addLog(`⚠ Failed to create folder, continuing...`);
                }

                // Create calendar event (server-side slot search + fallback)
                updateJourneyStep(lead.id, "booking", "running");
                addLog(`${dryRun ? "DRY RUN: " : ""}Scheduling meeting with ${leadName}...`);

                const scheduleIdempotencyKey = buildLeadActionIdempotencyKey({ runId, leadDocId, action: "calendar.schedule" });
                const scheduleHeaders = await buildAuthHeaders(user, {
                    idempotencyKey: scheduleIdempotencyKey,
                    correlationId,
                });

                const scheduleAttempt = async (slotSearch: {
                    timeZone: string;
                    leadTimeDays: number;
                    slotMinutes: number;
                    businessStartHour: number;
                    businessEndHour: number;
                    searchDays: number;
                    maxSlots: number;
                    anchorHour: number;
                }) => {
                    const scheduleResponse = await fetch("/api/calendar/schedule", {
                        method: "POST",
                        headers: scheduleHeaders,
                        body: JSON.stringify({
                            runId,
                            leadDocId,
                            receiptActionId: "calendar.booking",
                            dryRun,
                            durationMinutes: 30,
                            slotSearch,
                            event: {
                                summary: `Discovery Call - ${lead.companyName}`,
                                description: `Call with ${leadName} from ${lead.companyName}`,
                                attendees: leadEmail ? [{ email: leadEmail }] : [],
                                conferenceData: {
                                    createRequest: {
                                        requestId: crypto.randomUUID(),
                                        conferenceSolutionKey: { type: "hangoutsMeet" },
                                    },
                                },
                            },
                        }),
                    });

                    const scheduleJson = await readApiJson<CalendarScheduleResponse & { error?: string; details?: unknown }>(scheduleResponse);
                    return { scheduleResponse, scheduleJson };
                };

                let meetingTime: Date | null = null;
                let meetLink: string | null = null;

                let scheduleResponse: Response | null = null;
                let scheduleJson: (CalendarScheduleResponse & { error?: string; details?: unknown }) | null = null;

                const userTimeZone =
                    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

                // Primary window: next 7 business days, 9a-5p.
                ({ scheduleResponse, scheduleJson } = await scheduleAttempt({
                    timeZone: userTimeZone,
                    leadTimeDays: 2,
                    slotMinutes: 30,
                    businessStartHour: 9,
                    businessEndHour: 17,
                    searchDays: 7,
                    maxSlots: 40,
                    anchorHour: 14,
                }));

                // Secondary window: expand to 14 days and broader hours if needed.
                if (!scheduleResponse.ok && scheduleResponse.status === 409) {
                    setDiagnostics((prev) => ({ ...prev, noSlot: (prev.noSlot || 0) + 1 }));
                    addLog(`⚠ No slot in primary window. Expanding search window...`);
                    ({ scheduleResponse, scheduleJson } = await scheduleAttempt({
                        timeZone: userTimeZone,
                        leadTimeDays: 2,
                        slotMinutes: 30,
                        businessStartHour: 8,
                        businessEndHour: 18,
                        searchDays: 14,
                        maxSlots: 100,
                        anchorHour: 13,
                    }));
                }

                if (scheduleResponse.ok && scheduleJson?.scheduledStart && scheduleJson.scheduledEnd) {
                    meetingTime = new Date(scheduleJson.scheduledStart);
                    meetLink =
                        scheduleJson.meetLink ||
                        scheduleJson?.event?.conferenceData?.entryPoints?.[0]?.uri ||
                        null;
                    updateJourneyStep(lead.id, "booking", "complete");
                    setDiagnostics((prev) => ({ ...prev, meetingsScheduled: (prev.meetingsScheduled || 0) + 1 }));
                    addLog(`✓ Meeting scheduled: ${meetingTime.toLocaleString()}`);
                    if (scheduleJson.checked && scheduleJson.checked > 1) {
                        addLog(`↪ Slot selected after ${scheduleJson.checked} checks`);
                    }
                } else if (scheduleResponse.status === 409) {
                    // Fallback: draft an email requesting availability (no silent skip).
                    updateJourneyStep(lead.id, "booking", "running");
                    if (leadEmail) {
                        addLog(`✉ No availability found. Drafting an email to request availability...`);
                        const draftBody = `
                            <h2>Hi ${leadName},</h2>
                            <p>I tried to find a quick 30-minute slot on my calendar, but didn’t see a clean opening this week.</p>
                            <p>Could you reply with 2-3 times that work for you next week? I’ll send an invite immediately.</p>
                            <br/>
                            <p>Best regards,</p>
                            <p>${identity.founderName}<br/>${identity.businessName}</p>
                        `;

                        const draftHeaders = await buildAuthHeaders(user, {
                            idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "gmail.draft" }),
                            correlationId,
                        });
                        const draftResponse = await fetch("/api/gmail/draft", {
                            method: "POST",
                            headers: draftHeaders,
                            body: JSON.stringify({
                                dryRun,
                                runId,
                                leadDocId,
                                receiptActionId: "gmail.availability_draft",
                                email: {
                                    to: [leadEmail],
                                    subject: `Quick scheduling question - ${lead.companyName}`,
                                    body: draftBody,
                                    isHtml: true,
                                },
                            }),
                        });

                        const draftJson = await readApiJson<GmailDraftResponse & { error?: string }>(draftResponse);
                        if (draftResponse.ok) {
                            updateJourneyStep(lead.id, "booking", "complete");
                            setDiagnostics((prev) => ({
                                ...prev,
                                meetingsDrafted: (prev.meetingsDrafted || 0) + 1,
                                emailsDrafted: (prev.emailsDrafted || 0) + 1,
                            }));
                            addLog(`✓ Draft created (Gmail Draft ID: ${draftJson.draftId || "unknown"})`);
                        } else {
                            updateJourneyStep(lead.id, "booking", "error");
                            addLog(`⚠ Failed to create draft email`);
                        }
                    } else {
                        updateJourneyStep(lead.id, "booking", "error");
                        addLog(`⚠ No availability found and no email available for fallback draft.`);
                    }
                } else {
                    updateJourneyStep(lead.id, "booking", "error");
                    addLog(`⚠ Meeting scheduling failed`);
                }

                let outreachAttempted = false;
                let outreachSucceeded = false;

                // Send email
                if (leadEmail) {
                    outreachAttempted = true;
                    updateJourneyStep(lead.id, "outreach", "running");
                    addLog(`${draftFirst ? "Drafting" : "Sending"} personalized email to ${leadName}...`);
                    const emailBody = `
                        <h2>Hi ${leadName},</h2>
                        <p>I noticed ${lead.companyName} and thought we could help with ${identity.primaryService}.</p>
                        <p>Our core value: ${identity.coreValue}</p>
                        <p><strong>Key benefit:</strong> ${identity.keyBenefit}</p>
                        ${meetingTime ? `<p>I've scheduled a brief 30-minute discovery call for ${meetingTime.toLocaleString()}.</p>` : ""}
                        ${meetLink ? `<p><strong>Join here:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ""}
                          <p>I've also created a shared folder for our collaboration: 
                        <a href="${folderResult?.mainFolder?.webViewLink || '#'}">View Folder</a></p>
                          <br/>
                          <p>Best regards,</p>
                          <p>${identity.founderName}<br/>${identity.businessName}</p>
                      `;

                    const emailHeaders = await buildAuthHeaders(user, {
                        idempotencyKey: buildLeadActionIdempotencyKey({
                            runId,
                            leadDocId,
                            action: draftFirst ? "gmail.outreach-draft" : "gmail.send",
                        }),
                        correlationId,
                    });
                    const emailResponse = await fetch(draftFirst ? "/api/gmail/draft" : "/api/gmail/send", {
                        method: "POST",
                        headers: emailHeaders,
                        body: JSON.stringify({
                            dryRun,
                            runId,
                            leadDocId,
                            receiptActionId: draftFirst ? "gmail.outreach_draft" : "gmail.outreach",
                            email: {
                                to: [leadEmail],
                                subject: `Quick Question - ${lead.companyName}`,
                                body: emailBody,
                                isHtml: true,
                            },
                        }),
                    });

                    if (emailResponse.ok) {
                        outreachSucceeded = true;
                        if (draftFirst) {
                            const draftJson = await readApiJson<GmailDraftResponse & { error?: string }>(emailResponse);
                            addLog(`✓ Outreach drafted (Gmail Draft ID: ${draftJson.draftId || "unknown"})`);
                            setDiagnostics((prev) => ({ ...prev, emailsDrafted: (prev.emailsDrafted || 0) + 1 }));
                        } else {
                            addLog(`✓ Email sent to ${leadEmail}`);
                            setDiagnostics((prev) => ({ ...prev, emailsSent: (prev.emailsSent || 0) + 1 }));
                        }

                        // Sync to CRM
                        try {
                            if (!dryRun) {
                                await dbService.addLead({
                                    userId: user.uid,
                                    name: leadName,
                                    email: leadEmail,
                                    company: lead.companyName,
                                    phone: leadPhone,
                                    website: lead.website,
                                    industry: lead.industry,
                                    score: lead.score,
                                    source: lead.source,
                                    status: 'contacted'
                                });
                                addLog(`✓ Syncing ${lead.companyName} to Deal Pipeline`);
                            } else {
                                addLog(`DRY RUN: Skipping Deal Pipeline sync`);
                            }
                        } catch (e) {
                            console.error("CRM sync error", e);
                        }
                    } else {
                        addLog(`⚠ Email ${draftFirst ? "draft" : "send"} failed`);
                    }
                } else {
                    addLog(`⚠ No email found for ${lead.companyName}, skipping email outreach`);
                    setDiagnostics((prev) => ({ ...prev, noEmail: (prev.noEmail || 0) + 1 }));
                }

                // --- NEW: Context-Aware AI ---
                // Context is already loaded! Using `context` variable.

                // 2. Sales Power-Ups using Context

                let followupAttempted = false;
                let followupSucceeded = false;

                // SMS
                if (useSMS && hasTwilio) {
                    followupAttempted = true;
                    updateJourneyStep(lead.id, "followup", "running");
                    if (!leadPhone) {
                        addLog(`⚠ No phone for ${lead.companyName}, skipping SMS`);
                    } else {
                        addLog(`📱 Sending SMS follow-up...`);
                        try {
                            if (dryRun) {
                                followupSucceeded = true;
                                addLog(`DRY RUN: Would send SMS to ${leadPhone}`);
                            } else {
                                const smsHeaders = await buildAuthHeaders(user, {
                                    idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "twilio.send-sms" }),
                                    correlationId,
                                });
                                const smsResponse = await fetch('/api/twilio/send-sms', {
                                    method: 'POST',
                                    headers: smsHeaders,
                                    body: JSON.stringify({
                                        to: leadPhone,
                                        message: `Hi ${leadName}, just sent you an email regarding ${lead.companyName}. - ${identity.founderName}`
                                    })
                                });
                                if (smsResponse.ok) {
                                    followupSucceeded = true;
                                    addLog(`✓ SMS sent successfully`);
                                }
                            }
                        } catch (e) { addLog(`⚠ SMS Error: ${e}`); }
                    }
                }

                // AI Outbound Call (NEW)
                if (useOutboundCall && hasTwilio && hasElevenLabs) {
                    followupAttempted = true;
                    updateJourneyStep(lead.id, "followup", "running");
                    if (!leadPhone) {
                        addLog(`⚠ No phone for ${lead.companyName}, skipping outbound call`);
                    } else {
                        addLog(`📞 Initiating AI Outbound Call...`);
                        try {
                            if (dryRun) {
                                followupSucceeded = true;
                                addLog(`DRY RUN: Would place outbound call to ${leadPhone}`);
                            } else {
                                updateJourneyStep(lead.id, "script", "running");
                                const callScript = await ScriptGenerator.generate(context, {
                                    companyName: lead.companyName,
                                    founderName: leadName,
                                    email: leadEmail,
                                    phone: leadPhone,
                                    targetIndustry: lead.industry,
                                } as LeadContext, 'voice');
                                updateJourneyStep(lead.id, "script", "complete");
                                scriptGenerated = true;
                                addLog(`📝 Script generated: "${callScript.slice(0, 30)}..."`);

                                const callHeaders = await buildAuthHeaders(user, {
                                    idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "twilio.make-call" }),
                                    correlationId,
                                });
                                const callResponse = await fetch('/api/twilio/make-call', {
                                    method: 'POST',
                                    headers: callHeaders,
                                    body: JSON.stringify({
                                        to: leadPhone,
                                        text: callScript,
                                        businessKey,
                                    })
                                });
                                if (!callResponse.ok) {
                                    throw new Error("Twilio call failed");
                                }

                                followupSucceeded = true;
                                addLog(`✓ Call connected with ElevenLabs playback voice`);
                            }
                        } catch (e) {
                            updateJourneyStep(lead.id, "script", "error");
                            scriptErrored = true;
                            addLog(`⚠ Call Error: ${e}`);
                        }
                    }
                }

                // Avatar Video (Enhanced with Context)
                if (useAvatar && hasHeyGen) {
                    outreachAttempted = true;
                    updateJourneyStep(lead.id, "outreach", "running");
                    addLog(`🎬 Creating context-aware avatar video...`);
                    try {
                        if (dryRun) {
                            outreachSucceeded = true;
                            addLog(`DRY RUN: Would create avatar video job`);
                            updateJourneyStep(lead.id, "script", "complete");
                        } else {
                            updateJourneyStep(lead.id, "script", "running");
                            const videoScript = await ScriptGenerator.generate(context, {
                                companyName: lead.companyName,
                                founderName: leadName,
                                email: leadEmail,
                                phone: leadPhone,
                                targetIndustry: lead.industry,
                            } as LeadContext, 'video');
                            updateJourneyStep(lead.id, "script", "complete");
                            scriptGenerated = true;
                            addLog(`📝 Video script tailored to ${lead.industry || 'industry'}`);

                            const avatarHeaders = await buildAuthHeaders(user, {
                                idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "heygen.create-avatar" }),
                                correlationId,
                            });
                            const avatarResponse = await fetch('/api/heygen/create-avatar', {
                                method: 'POST',
                                headers: avatarHeaders,
                                body: JSON.stringify({
                                    script: videoScript
                                })
                            });
                            if (avatarResponse.ok) {
                                outreachSucceeded = true;
                                await new Promise(r => setTimeout(r, 1000));
                                addLog(`✓ Avatar video queued for generation`);
                            } else {
                                addLog(`⚠ Avatar request failed`);
                            }
                        }
                    } catch (e) {
                        updateJourneyStep(lead.id, "script", "error");
                        scriptErrored = true;
                        addLog(`⚠ Avatar Error: ${e}`);
                    }
                }

                if (!outreachAttempted) {
                    updateJourneyStep(lead.id, "outreach", "skipped");
                } else if (outreachSucceeded) {
                    updateJourneyStep(lead.id, "outreach", "complete");
                } else {
                    updateJourneyStep(lead.id, "outreach", "error");
                }

                if (!followupAttempted) {
                    updateJourneyStep(lead.id, "followup", "skipped");
                } else if (followupSucceeded) {
                    updateJourneyStep(lead.id, "followup", "complete");
                } else {
                    updateJourneyStep(lead.id, "followup", "error");
                }

                if (needsScript && !scriptGenerated && !scriptErrored) {
                    updateJourneyStep(lead.id, "script", "skipped");
                }

                addLog(`✓ ${lead.companyName} outreach complete!\n`);

                // Rate limit between leads
                await new Promise(r => setTimeout(r, 2000));
            }

            addLog("\n🎉 Lead run completed successfully!");
            addLog(`Total leads processed: ${sourcedLeads.length}`);

            toast.success("Lead Run Completed!", {
                description: `Processed ${sourcedLeads.length} leads through your outreach stack`,
                icon: <CheckCircle2 className="h-4 w-4" />,
            });
            localStorage.setItem("mission_control_last_run_id", runId);

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Lead run error:", error);
            addLog(`\n❌ Error: ${message}`);
            setLastErrorMessage(message);
            reportClientError(message, { source: "operations.handle_run" });
            toast.error("Lead Run Failed", {
                description: message,
            });
        } finally {
            setIsRunning(false);
        }
    };

    const selectedReceiptLead =
        receiptLeads.find((lead) => lead.leadDocId === selectedReceiptLeadId || lead.id === selectedReceiptLeadId) ||
        null;

    function Header() {
        return (
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold text-white">Lead Engine</h1>
                    <p className="text-zinc-400">Source, score, and outreach to your best leads</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-800">
                    <Activity className={`h-4 w-4 ${user ? 'text-green-500' : 'text-red-500'}`} />
                    <span className={`text-sm font-medium ${user ? 'text-green-500' : 'text-red-500'}`}>
                        {user ? 'Outreach Stack Online' : 'Not Signed In'}
                    </span>
                </div>
            </div>
        );
    }

    function MainPanel() {
        return (
            <div className="lg:col-span-2 space-y-6">
                <RunDiagnostics diagnostics={diagnostics} />
                <LeadJourney
                    journeys={journeys}
                    runId={sourceRunId}
                    warnings={sourceWarnings}
                    selectedLeadId={selectedReceiptLeadId}
                    onViewDetails={(leadId) => setSelectedReceiptLeadId(leadId)}
                />

                <Card className="bg-zinc-950 border-zinc-800 shadow-lg overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                        <div className="flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-zinc-400" />
                            <span className="text-sm font-mono text-zinc-400">Live Lead Run Logs</span>
                        </div>
                        {lastErrorMessage && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                onClick={() => {
                                    reportClientError(lastErrorMessage, {
                                        source: "operations.manual_report",
                                        runId: sourceRunId || null,
                                    });
                                    toast.success("Error reported for triage");
                                }}
                            >
                                <Bug className="mr-1 h-3.5 w-3.5" />
                                Report This
                            </Button>
                        )}
                        {isRunning && (
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                                <span className="text-xs text-green-500 font-mono">RUNNING</span>
                            </div>
                        )}
                    </div>

                    <CardContent className="p-0">
                        <div className="h-[500px] overflow-y-auto bg-black font-mono text-sm">
                            <div className="p-6 space-y-2">
                                {logs.length === 0 ? (
                                    <div className="flex items-center gap-2 text-zinc-600">
                                        <AlertCircle className="h-4 w-4" />
                                        <span>Ready to run. Click &quot;Run Lead Engine&quot; to begin...</span>
                                    </div>
                                ) : (
                                    logs.map((log, i) => (
                                        <div
                                            key={i}
                                            className={`flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300 ${log.includes('✓') ? 'text-green-400' :
                                                log.includes('⚠') ? 'text-yellow-400' :
                                                    log.includes('❌') ? 'text-red-400' :
                                                        log.includes('🎉') ? 'text-blue-400' :
                                                            'text-zinc-300'
                                                }`}
                                        >
                                            {log.includes('✓') && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                                            <span className="flex-1 whitespace-pre-wrap">{log}</span>
                                        </div>
                                    ))
                                )}
                                {isRunning && (
                                    <div className="flex items-center gap-2 text-blue-400">
                                        <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></div>
                                        <span className="animate-pulse">_</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {sourceRunId && (
                    <Card className="bg-zinc-950 border-zinc-800 shadow-lg overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                            <span className="text-sm font-medium text-zinc-300">Error Triage</span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                onClick={() => void loadTelemetryGroups(sourceRunId)}
                                disabled={loadingTelemetry}
                            >
                                {loadingTelemetry ? "Loading..." : "Refresh"}
                            </Button>
                        </div>
                        <CardContent className="p-4">
                            {telemetryGroups.length === 0 ? (
                                <p className="text-sm text-zinc-500">
                                    {loadingTelemetry
                                        ? "Loading telemetry groups..."
                                        : "No telemetry groups found for this run yet."}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {telemetryGroups.map((group) => (
                                        <div key={group.fingerprint} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-sm text-zinc-200">
                                                    {group.sample?.message || "Telemetry group"}
                                                </p>
                                                <span className="text-xs text-zinc-500">x{group.count}</span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                                {group.triage?.issueUrl ? (
                                                    <a
                                                        href={group.triage.issueUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-blue-300 hover:text-blue-200 underline underline-offset-2"
                                                    >
                                                        GitHub Issue #{group.triage.issueNumber || "?"}
                                                    </a>
                                                ) : (
                                                    <span className="text-zinc-400">Issue pending triage</span>
                                                )}
                                                <span className="text-zinc-500">status: {group.triage?.status || "new"}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        );
    }

    

    function ControlPanel() {
        return (
                        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                            <CardContent className="p-6 space-y-6">
                                <div className="space-y-2">
                                    <h3 className="text-lg font-semibold text-white">Lead Run Parameters</h3>
                                    <p className="text-sm text-zinc-400">Configure your sourcing + scoring settings</p>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-zinc-200">Saved Run Templates</Label>
                                        <div className="flex items-center gap-2">
                                            <Select
                                                value={selectedTemplateId || undefined}
                                                onValueChange={onSelectTemplate}
                                                disabled={!user || templatesLoading}
                                            >
                                                <SelectTrigger className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
                                                    <SelectValue
                                                        placeholder={templatesLoading ? "Loading templates..." : "Select a template..."}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                                                    {templates.length === 0 ? (
                                                        <SelectItem value="__empty__" disabled>
                                                            No saved templates
                                                        </SelectItem>
                                                    ) : (
                                                        templates.map((t) => (
                                                            <SelectItem key={t.templateId} value={t.templateId}>
                                                                {t.clientName ? `${t.clientName} - ${t.name}` : t.name}
                                                            </SelectItem>
                                                        ))
                                                    )}
                                                </SelectContent>
                                            </Select>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                onClick={loadTemplates}
                                                disabled={!user || templatesLoading}
                                                className="h-11 w-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                aria-label="Refresh templates"
                                            >
                                                <RefreshCcw className={templatesLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                                            </Button>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                onClick={openTemplateDialog}
                                                disabled={!user}
                                                className="h-9 bg-zinc-900 border border-zinc-700 text-white hover:bg-zinc-800"
                                            >
                                                <Save className="h-4 w-4" />
                                                {selectedTemplateId ? "Update Template" : "Save Template"}
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={clearTemplateSelection}
                                                disabled={!selectedTemplateId}
                                                className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                            >
                                                <Bookmark className="h-4 w-4" />
                                                Clear
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={deleteSelectedTemplate}
                                                disabled={!selectedTemplateId || templateDeleting}
                                                className="h-9 border-red-900 bg-zinc-900 text-red-400 hover:bg-red-950/40 hover:text-red-200"
                                            >
                                                <Trash2 className={templateDeleting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                                                Delete
                                            </Button>
                                        </div>

                                        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                                            <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                                                <DialogHeader>
                                                    <DialogTitle className="text-white">Save Lead Run Template</DialogTitle>
                                                    <DialogDescription className="text-zinc-400">
                                                        Store your run settings so you can re-run them in one click.
                                                    </DialogDescription>
                                                </DialogHeader>

                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium text-zinc-200">Template Name</Label>
                                                        <Input
                                                            value={templateName}
                                                            onChange={(e) => setTemplateName(e.target.value)}
                                                            placeholder="e.g. Austin HVAC High Intent"
                                                            className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium text-zinc-200">Client / Org (optional)</Label>
                                                        <Input
                                                            value={templateClientName}
                                                            onChange={(e) => setTemplateClientName(e.target.value)}
                                                            placeholder="e.g. McCullough, Inc."
                                                            className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                                        />
                                                    </div>
                                                </div>

                                                <DialogFooter>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={() => setTemplateDialogOpen(false)}
                                                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                    >
                                                        Cancel
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        onClick={saveTemplate}
                                                        disabled={templateSaving}
                                                        className="bg-blue-600 hover:bg-blue-500 text-white"
                                                    >
                                                        {templateSaving ? "Saving..." : "Save"}
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </div>

                                    <div className="space-y-2 pt-2 border-t border-zinc-800">
                                        <Label className="text-sm font-medium text-zinc-200">Load Existing Run</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                value={receiptRunIdInput}
                                                onChange={(e) => setReceiptRunIdInput(e.target.value)}
                                                placeholder="Paste run ID..."
                                                className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => void loadRunReceipts(receiptRunIdInput)}
                                                disabled={!user || !receiptRunIdInput.trim() || loadingReceipts}
                                                className="h-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                            >
                                                {loadingReceipts ? "Loading..." : "Load"}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={exportReceiptsCsv}
                                                disabled={receiptLeads.length === 0}
                                                className="h-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                title={receiptLeads.length === 0 ? "Load a run to enable export" : "Export CSV"}
                                            >
                                                <Download className="mr-2 h-4 w-4" />
                                                Export
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setAuditOpen(true)}
                                                disabled={receiptLeads.length === 0}
                                                className="h-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                title={receiptLeads.length === 0 ? "Load a run to enable audit view" : "Audit run receipts"}
                                            >
                                                <ShieldCheck className="mr-2 h-4 w-4" />
                                                Audit
                                            </Button>
                                        </div>
                                        <p className="text-xs text-zinc-500">
                                            Rehydrate receipts + lead journey from a prior run. Persists across refresh.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-zinc-200">Lead Query</Label>
                                        <Input
                                            value={leadQuery}
                                            onChange={(e) => setLeadQuery(e.target.value)}
                                            placeholder="e.g. HVAC contractors"
                                            className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium text-zinc-200">Target Industry</Label>
                                            <Input
                                                value={targetIndustry}
                                                onChange={(e) => setTargetIndustry(e.target.value)}
                                                placeholder="e.g. Healthcare"
                                                className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium text-zinc-200">Target Location</Label>
                                            <Input
                                                value={targetLocation}
                                                onChange={(e) => setTargetLocation(e.target.value)}
                                                placeholder="e.g. Austin, TX"
                                                className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-zinc-200">Business Workspace</Label>
                                        <Select
                                            value={businessKey}
                                            onValueChange={(value) => setBusinessKey(value as "aicf" | "rng" | "rts")}
                                        >
                                            <SelectTrigger className="h-11 bg-zinc-900 border-zinc-700 text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                                                <SelectItem value="aicf">AI CoFoundry</SelectItem>
                                                <SelectItem value="rng">Rosser NFT Gallery</SelectItem>
                                                <SelectItem value="rts">RT Solutions</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-zinc-500">
                                            Sets the default voice profile for outbound calls and template behavior.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium text-zinc-200">Lead Limit</Label>
                                            <Input
                                                type="number"
                                                value={limit}
                                                onChange={(e) => setLimit(Number(e.target.value))}
                                                className="h-11 bg-zinc-900 border-zinc-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium text-zinc-200">Minimum Score</Label>
                                            <Input
                                                type="number"
                                                value={minScore}
                                                onChange={(e) => setMinScore(Number(e.target.value))}
                                                className="h-11 bg-zinc-900 border-zinc-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <p className="text-xs text-zinc-500">
                                    {hasGooglePlaces
                                        ? "Google Places sourcing is active for live lead discovery."
                                        : "Add a Google Places API key in the API Vault to source live leads. Otherwise we’ll use existing CRM leads."}
                                    {hasFirecrawl
                                        ? " Firecrawl enrichment is enabled for website signals (emails, metadata)."
                                        : " Add a Firecrawl key to enrich lead websites and improve scoring."}
                                </p>

                                <div className="pt-4 border-t border-zinc-800 space-y-3">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-semibold text-white">Outreach Power-Ups ⚡</h3>
                                        <p className="text-xs text-zinc-400">Enhance outreach with AI channels</p>
                                    </div>

                                    <div className="pt-4 border-t border-zinc-800">
                                        <KnowledgeBase />
                                    </div>

                                     <div className="space-y-3 pt-4 border-t border-zinc-800">
                                             <div className="space-y-1">
                                                 <h3 className="text-sm font-semibold text-white">Advanced AI Actions ⚡</h3>
                                                 <p className="text-xs text-zinc-400">Context-aware agentic outreach</p>
                                             </div>

                                        <div className="space-y-3">
                                            <div className="flex items-start space-x-3">
                                                <input
                                                    type="checkbox"
                                                    id="useSMS"
                                                    checked={useSMS}
                                                    onChange={(e) => setUseSMS(e.target.checked)}
                                                    disabled={!hasTwilio}
                                                    className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500/20 disabled:opacity-50"
                                                />
                                                <div className="grid gap-1.5 leading-none">
                                                    <label htmlFor="useSMS" className="text-sm font-medium leading-none text-zinc-200">
                                                        Enable SMS Follow-up
                                                    </label>
                                                </div>
                                            </div>

                                            <div className="flex items-start space-x-3">
                                                <input
                                                    type="checkbox"
                                                    id="useOutboundCall"
                                                    checked={useOutboundCall}
                                                    onChange={(e) => setUseOutboundCall(e.target.checked)}
                                                    disabled={!hasTwilio || !hasElevenLabs}
                                                    className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-red-600 focus:ring-red-500/20 disabled:opacity-50"
                                                />
                                                <div className="grid gap-1.5 leading-none">
                                                    <label htmlFor="useOutboundCall" className="text-sm font-medium leading-none text-zinc-200">
                                                        AI Outbound Call
                                                    </label>
                                                    <p className="text-xs text-zinc-500">
                                                        Calls lead & plays personalized message
                                                    </p>
                                                </div>
                                            </div>

                                             <div className="flex items-start space-x-3">
                                                 <input
                                                     type="checkbox"
                                                     id="useAvatar"
                                                     checked={useAvatar}
                                                     onChange={(e) => setUseAvatar(e.target.checked)}
                                                     disabled={!hasHeyGen}
                                                     className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-green-600 focus:ring-green-500/20 disabled:opacity-50"
                                                 />
                                                 <div className="grid gap-1.5 leading-none">
                                                     <label htmlFor="useAvatar" className="text-sm font-medium leading-none text-zinc-200">
                                                         Context-Aware Avatar Video
                                                     </label>
                                                     <p className="text-xs text-zinc-500">
                                                         Generates script from Knowledge Base
                                                     </p>
                                                 </div>
                                             </div>

                                             <div className="flex items-start space-x-3">
                                                 <input
                                                     type="checkbox"
                                                     id="draftFirst"
                                                     checked={draftFirst}
                                                     onChange={(e) => setDraftFirst(e.target.checked)}
                                                     className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-yellow-500 focus:ring-yellow-500/20"
                                                 />
                                                 <div className="grid gap-1.5 leading-none">
                                                     <label htmlFor="draftFirst" className="text-sm font-medium leading-none text-zinc-200">
                                                         Draft-first outreach mode
                                                     </label>
                                                     <p className="text-xs text-zinc-500">
                                                         Save/send as Gmail drafts for review instead of immediate send.
                                                     </p>
                                                 </div>
                                             </div>
                                          </div>
                                      </div>
                                  </div>

                                <div className="pt-4 border-t border-zinc-800">
                                    <div className="flex items-start space-x-3">
                                        <input
                                            type="checkbox"
                                            id="dryRun"
                                            checked={dryRun}
                                            onChange={(e) => setDryRun(e.target.checked)}
                                            disabled={isRunning}
                                            className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-yellow-500 focus:ring-yellow-500/20 disabled:opacity-50"
                                        />
                                        <div className="grid gap-1.5 leading-none">
                                            <label htmlFor="dryRun" className="text-sm font-medium leading-none text-zinc-200">
                                                Dry Run (no side effects)
                                            </label>
                                            <p className="text-xs text-zinc-500">
                                                Simulates calendar/email/drive actions and writes receipts as simulated.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {isRunning ? (
                                    <Button
                                        onClick={stopCampaign}
                                        variant="destructive"
                                        className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-semibold shadow-lg transition-all"
                                    >
                                        <Activity className="mr-2 h-5 w-5 animate-pulse" />
                                        Stop Lead Run
                                    </Button>
                                ) : (
                                    <div className="space-y-2">
                                        <Button
                                            onClick={handleRun}
                                            disabled={!user}
                                            className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <AfroGlyph variant="operations" className="mr-2 h-5 w-5" />
                                            Run Lead Engine
                                        </Button>
                                        <Button
                                            onClick={startBackgroundRun}
                                            disabled={!user || startingBackgroundRun}
                                            variant="outline"
                                            className="w-full h-11 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                                        >
                                            <Clock3 className={startingBackgroundRun ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
                                            {startingBackgroundRun ? "Starting Background Run..." : "Run In Background"}
                                        </Button>
                                    </div>
                                )}

                                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs text-zinc-300 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-zinc-200 flex items-center gap-2">
                                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                            Secrets Health
                                        </p>
                                        <Link href="/dashboard/settings?tab=integrations" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                                            API Vault
                                            <ArrowUpRight className="h-3 w-3" />
                                        </Link>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <p className={googleConnected ? "text-emerald-400" : "text-amber-400"}>
                                            Google: {googleConnected ? "connected" : "missing"}
                                        </p>
                                        <p className={hasTwilio ? "text-emerald-400" : "text-amber-400"}>
                                            Twilio: {hasTwilio ? "ready" : "missing"}
                                        </p>
                                        <p className={hasElevenLabs ? "text-emerald-400" : "text-amber-400"}>
                                            ElevenLabs: {hasElevenLabs ? "ready" : "missing"}
                                        </p>
                                        <p className={hasHeyGen ? "text-emerald-400" : "text-zinc-500"}>
                                            HeyGen: {hasHeyGen ? "ready" : "optional"}
                                        </p>
                                    </div>
                                </div>

                                {backgroundJob && (
                                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300 space-y-2">
                                        <p>
                                            Background status: <span className="font-semibold text-white">{backgroundJob.status}</span>
                                            {" "}({Math.min(backgroundJob.nextIndex, backgroundJob.totalLeads)}/{backgroundJob.totalLeads})
                                        </p>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                            <p className="text-zinc-500">
                                                Queue lag: <span className="text-zinc-300">{backgroundJob.queueLagSeconds ?? 0}s</span>
                                            </p>
                                            <p className="text-zinc-500">
                                                Failed leads: <span className="text-zinc-300">{backgroundJob.diagnostics?.failedLeads || 0}</span>
                                            </p>
                                            <p className="text-zinc-500">
                                                Channel failures: <span className="text-zinc-300">{backgroundJob.diagnostics?.channelFailures || 0}</span>
                                            </p>
                                            <p className="text-zinc-500">
                                                Calendar retries: <span className="text-zinc-300">{backgroundJob.diagnostics?.calendarRetries || 0}</span>
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={jobActionLoading || backgroundJob.status === "completed" || backgroundJob.status === "failed"}
                                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                onClick={() =>
                                                    void controlBackgroundJob(
                                                        backgroundJob.status === "paused" ? "resume" : "pause"
                                                    )
                                                }
                                            >
                                                {backgroundJob.status === "paused" ? (
                                                    <Play className="mr-1 h-3.5 w-3.5" />
                                                ) : (
                                                    <Pause className="mr-1 h-3.5 w-3.5" />
                                                )}
                                                {backgroundJob.status === "paused" ? "Resume" : "Pause"}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={jobActionLoading}
                                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                                onClick={() => sourceRunId && void refreshBackgroundJob(sourceRunId)}
                                            >
                                                Refresh Status
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs text-zinc-300 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-zinc-200 flex items-center gap-2">
                                            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
                                            Drive Delta Scan
                                        </p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={driveDeltaRunning}
                                            className="h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                            onClick={() => void runDriveDeltaScan()}
                                        >
                                            {driveDeltaRunning ? "Running..." : "Run now"}
                                        </Button>
                                    </div>
                                    {driveDeltaLoading ? (
                                        <p className="text-[11px] text-zinc-500">Loading status...</p>
                                    ) : driveDelta ? (
                                        <div className="space-y-1 text-[11px]">
                                            <p>
                                                Last run: <span className="text-zinc-200">{driveDelta.lastRunAt ? new Date(driveDelta.lastRunAt).toLocaleString() : "Never"}</span>
                                            </p>
                                            <p>
                                                Last checkpoint: <span className="text-zinc-200">{driveDelta.lastCheckpoint || "Not set"}</span>
                                            </p>
                                            <p>
                                                Files captured: <span className="text-zinc-200">{driveDelta.lastResultCount}</span>
                                            </p>
                                            <p className={driveDelta.staleDays !== null && driveDelta.staleDays >= 7 ? "text-amber-400" : "text-zinc-500"}>
                                                {driveDelta.staleDays !== null ? `Stale after ${driveDelta.staleDays} day(s)` : "No baseline yet"}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-[11px] text-zinc-500">No scan history yet. Run once to initialize weekly delta tracking.</p>
                                    )}
                                </div>

                                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-zinc-200">Daily Quota</p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={loadingQuota}
                                            className="h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                            onClick={() => void loadQuotaSummary()}
                                        >
                                            {loadingQuota ? "..." : "Refresh"}
                                        </Button>
                                    </div>
                                    {quotaSummary ? (
                                        <div className="space-y-2">
                                            <div>
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span>Runs: {quotaSummary.runsUsed}/{quotaSummary.maxRunsPerDay}</span>
                                                    <span>{quotaSummary.utilization.runsPct}%</span>
                                                </div>
                                                <div className="mt-1 h-1.5 rounded bg-zinc-800">
                                                    <div
                                                        className="h-1.5 rounded bg-blue-500"
                                                        style={{ width: `${quotaSummary.utilization.runsPct}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span>Leads: {quotaSummary.leadsUsed}/{quotaSummary.maxLeadsPerDay}</span>
                                                    <span>{quotaSummary.utilization.leadsPct}%</span>
                                                </div>
                                                <div className="mt-1 h-1.5 rounded bg-zinc-800">
                                                    <div
                                                        className="h-1.5 rounded bg-cyan-500"
                                                        style={{ width: `${quotaSummary.utilization.leadsPct}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-zinc-500">
                                                Remaining today: {quotaSummary.runsRemaining} runs, {quotaSummary.leadsRemaining} leads
                                            </p>
                                            <p className="text-[11px] text-zinc-500">
                                                Active runs: {quotaSummary.activeRuns}/{quotaSummary.maxActiveRuns}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-[11px] text-zinc-500">
                                            {loadingQuota ? "Loading quota..." : "Quota not loaded yet."}
                                        </p>
                                    )}
                                </div>

                                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-zinc-200">Run Alerts</p>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={loadingAlerts}
                                            className="h-7 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                                            onClick={() => void loadAlerts()}
                                        >
                                            {loadingAlerts ? "..." : "Refresh"}
                                        </Button>
                                    </div>
                                    {alerts.length === 0 ? (
                                        <p className="text-[11px] text-zinc-500">
                                            {loadingAlerts ? "Loading alerts..." : "No active alerts."}
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {alerts.map((alert) => (
                                                <div key={alert.alertId} className="rounded border border-zinc-800 bg-zinc-950/50 px-2 py-2 space-y-1">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div>
                                                            <p className="text-[11px] font-medium text-zinc-200">{alert.title}</p>
                                                            <p className="text-[11px] text-zinc-500">{alert.message}</p>
                                                        </div>
                                                        <span className={`text-[10px] uppercase tracking-wide ${alert.status === "acked" ? "text-zinc-500" : "text-amber-300"}`}>
                                                            {alert.status}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] text-zinc-500">
                                                            Run {alert.runId.slice(0, 8)} • streak {alert.failureStreak}
                                                            {alert.escalatedAt ? " • escalated" : ""}
                                                        </span>
                                                        {alert.status !== "acked" && (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={acknowledgingAlertId === alert.alertId}
                                                                className="h-6 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white text-[10px]"
                                                                onClick={() => void acknowledgeAlert(alert.alertId)}
                                                            >
                                                                {acknowledgingAlertId === alert.alertId ? "Ack..." : "Acknowledge"}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {!user && (
                                    <p className="text-xs text-red-400 text-center">
                                        Please sign in to run lead sourcing
                                    </p>
                                )}
                            </CardContent>
                        </Card>
        );
    }

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <Header />

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Control Panel */}
                    <div className="lg:col-span-1">
                        <ControlPanel />
                    </div>

                    <MainPanel />
                </div>
            </div>
            <LeadReceiptDrawer
                open={Boolean(selectedReceiptLeadId)}
                onOpenChange={(open) => {
                    if (!open) setSelectedReceiptLeadId(null);
                }}
                lead={selectedReceiptLead}
            />
            <RunAuditDrawer
                open={auditOpen}
                onOpenChange={setAuditOpen}
                run={receiptRunMeta}
                leads={receiptLeads}
                onSelectLead={(leadDocId) => {
                    setSelectedReceiptLeadId(leadDocId);
                    setAuditOpen(false);
                }}
            />
        </div>
    );
}
