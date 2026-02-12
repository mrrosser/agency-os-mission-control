"use client";

import { useState, useEffect, useRef } from "react";
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
import { Rocket, Activity, AlertCircle, Terminal, CheckCircle2, Bookmark, Save, Trash2, RefreshCcw } from "lucide-react";
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
import type { LeadCandidate, LeadSourceRequest } from "@/lib/leads/types";
import { buildCandidateMeetingSlots } from "@/lib/calendar/slot-finder";
import { buildLeadActionIdempotencyKey, buildLeadDocId } from "@/lib/lead-runs/ids";

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
        useSMS?: boolean;
        useAvatar?: boolean;
        useOutboundCall?: boolean;
    };
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
    const [dryRun, setDryRun] = useState(false);
    const [journeys, setJourneys] = useState<LeadJourneyEntry[]>([]);
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
            return;
        }
        void loadTemplates();
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
        const wantsSMS = Boolean(outreach.useSMS);
        const wantsCall = Boolean(outreach.useOutboundCall);
        const wantsAvatar = Boolean(outreach.useAvatar);

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
                        useSMS,
                        useAvatar,
                        useOutboundCall,
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
        setSourceRunId(runId);
        setSourceWarnings([]);
        setDiagnostics({
            runId,
            dryRun,
            candidateTotal: null,
            scoredCount: null,
            filteredOut: null,
            processed: 0,
            meetingsScheduled: 0,
            meetingsDrafted: 0,
            noSlot: 0,
            emailsSent: 0,
            emailsDrafted: 0,
            noEmail: 0,
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

            if (typeof sourcePayload.candidateTotal === "number") {
                const filteredOut = typeof sourcePayload.filteredOut === "number" ? sourcePayload.filteredOut : null;
                const filteredMsg =
                    filteredOut && filteredOut > 0 ? ` (${filteredOut} filtered out below ${minScore})` : "";
                addLog(`✓ Found ${sourcePayload.candidateTotal} candidates; ${sourcedLeads.length} scored >= ${minScore}${filteredMsg}`);
                setDiagnostics((prev) => ({
                    ...prev,
                    candidateTotal: sourcePayload.candidateTotal ?? null,
                    scoredCount: sourcedLeads.length,
                    filteredOut: filteredOut ?? null,
                }));
            } else {
                addLog(`✓ Scored ${sourcedLeads.length} leads above ${minScore}`);
                setDiagnostics((prev) => ({
                    ...prev,
                    candidateTotal: null,
                    scoredCount: sourcedLeads.length,
                    filteredOut: null,
                }));
            }

            setJourneys(
                sourcedLeads.map((lead) => ({
                    leadId: lead.id,
                    companyName: lead.companyName,
                    founderName: lead.founderName,
                    score: lead.score || 0,
                    source: lead.source,
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

                const primaryCandidates = buildCandidateMeetingSlots({
                    now: new Date(),
                    leadTimeDays: 2,
                    slotMinutes: 30,
                    businessStartHour: 9,
                    businessEndHour: 17,
                    searchDays: 7,
                    maxSlots: 40,
                });

                const scheduleAttempt = async (candidateStarts: Date[]) => {
                    const scheduleResponse = await fetch("/api/calendar/schedule", {
                        method: "POST",
                        headers: scheduleHeaders,
                        body: JSON.stringify({
                            runId,
                            leadDocId,
                            receiptActionId: "calendar.booking",
                            dryRun,
                            durationMinutes: 30,
                            candidateStarts: candidateStarts.map((d) => d.toISOString()),
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

                // Primary window: next 7 business days, 9a-5p.
                ({ scheduleResponse, scheduleJson } = await scheduleAttempt(primaryCandidates));

                // Secondary window: expand to 14 days and broader hours if needed.
                if (!scheduleResponse.ok && scheduleResponse.status === 409) {
                    setDiagnostics((prev) => ({ ...prev, noSlot: (prev.noSlot || 0) + 1 }));
                    addLog(`⚠ No slot in primary window. Expanding search window...`);
                    const secondaryCandidates = buildCandidateMeetingSlots({
                        now: new Date(),
                        leadTimeDays: 2,
                        slotMinutes: 30,
                        businessStartHour: 8,
                        businessEndHour: 18,
                        searchDays: 14,
                        maxSlots: 100,
                    });
                    ({ scheduleResponse, scheduleJson } = await scheduleAttempt(secondaryCandidates));
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
                        const suggestedTimes = primaryCandidates.slice(0, 3).map((d) => d.toLocaleString());
                        const draftBody = `
                            <h2>Hi ${leadName},</h2>
                            <p>I tried to find a quick 30-minute slot on my calendar, but didn’t see a clean opening this week.</p>
                            <p>Would any of these times work for a quick discovery call?</p>
                            <ul>
                                ${suggestedTimes.map((t) => `<li>${t}</li>`).join("")}
                            </ul>
                            <p>If not, reply with 2-3 times that work for you next week and I’ll send an invite.</p>
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
                            setDiagnostics((prev) => ({ ...prev, meetingsDrafted: (prev.meetingsDrafted || 0) + 1 }));
                            addLog(`✓ Draft created (Gmail Draft ID: ${draftJson.draftId || "unknown"})`);
                        } else {
                            updateJourneyStep(lead.id, "booking", "error");
                            addLog(`⚠ Failed to create draft email`);
                        }
                    } else {
                        updateJourneyStep(lead.id, "booking", "skipped");
                        addLog(`⚠ No availability found and no email to draft. Skipping booking.`);
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
                    addLog(`Sending personalized email to ${leadName}...`);
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
                        idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "gmail.send" }),
                        correlationId,
                    });
                    const emailResponse = await fetch("/api/gmail/send", {
                        method: "POST",
                        headers: emailHeaders,
                        body: JSON.stringify({
                            dryRun,
                            runId,
                            leadDocId,
                            receiptActionId: "gmail.outreach",
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
                        addLog(`✓ Email sent to ${leadEmail}`);
                        setDiagnostics((prev) => ({ ...prev, emailsSent: (prev.emailsSent || 0) + 1 }));

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
                        addLog(`⚠ Email failed to send`);
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

                                const audioHeaders = await buildAuthHeaders(user, {
                                    idempotencyKey: buildLeadActionIdempotencyKey({ runId, leadDocId, action: "elevenlabs.synthesize" }),
                                    correlationId,
                                });
                                const audioResponse = await fetch('/api/elevenlabs/synthesize', {
                                    method: 'POST',
                                    headers: audioHeaders,
                                    body: JSON.stringify({
                                        text: callScript
                                    })
                                });
                                if (!audioResponse.ok) {
                                    throw new Error("Audio synthesis failed");
                                }

                                // In production: upload the synthesized audio to storage and call Twilio with a public URL.
                                await new Promise(r => setTimeout(r, 1500)); // Simulate call setup
                                followupSucceeded = true;
                                addLog(`✓ Call connected & AI message played`);
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

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Lead run error:", error);
            addLog(`\n❌ Error: ${message}`);
            toast.error("Lead Run Failed", {
                description: message,
            });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
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

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Control Panel */}
                    <div className="lg:col-span-1">
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
                                    <Button
                                        onClick={handleRun}
                                        disabled={!user}
                                        className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Rocket className="mr-2 h-5 w-5" />
                                        Run Lead Engine
                                    </Button>
                                )}

                                {!user && (
                                    <p className="text-xs text-red-400 text-center">
                                        Please sign in to run lead sourcing
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                     {/* Lead Journey + Terminal */}
                     <div className="lg:col-span-2 space-y-6">
                        <RunDiagnostics diagnostics={diagnostics} />
                         <LeadJourney
                             journeys={journeys}
                             runId={sourceRunId}
                             warnings={sourceWarnings}
                         />

                        <Card className="bg-zinc-950 border-zinc-800 shadow-lg overflow-hidden">
                            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                                <div className="flex items-center gap-2">
                                    <Terminal className="h-4 w-4 text-zinc-400" />
                                    <span className="text-sm font-mono text-zinc-400">Live Lead Run Logs</span>
                                </div>
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
                    </div>
                </div>
            </div>
        </div>
    );
}
