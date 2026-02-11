"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, Gauge, Sparkles, Mail, PhoneCall, CalendarCheck } from "lucide-react";

export type LeadJourneyStepKey =
    | "source"
    | "score"
    | "enrich"
    | "script"
    | "outreach"
    | "followup"
    | "booking";

export type LeadJourneyStatus = "pending" | "running" | "complete" | "skipped" | "error";

export interface LeadJourneyEntry {
    leadId: string;
    companyName: string;
    founderName?: string;
    score?: number;
    source?: string;
    steps: Record<LeadJourneyStepKey, LeadJourneyStatus>;
}

interface LeadJourneyProps {
    journeys: LeadJourneyEntry[];
    runId?: string | null;
    warnings?: string[];
}

const STEP_DEFS: Array<{
    key: LeadJourneyStepKey;
    label: string;
    type: "MCP" | "AI";
    icon: typeof Search;
}> = [
        { key: "source", label: "Source", type: "MCP", icon: Search },
        { key: "score", label: "Score", type: "AI", icon: Gauge },
        { key: "enrich", label: "Enrich", type: "MCP", icon: Sparkles },
        { key: "script", label: "Script", type: "AI", icon: Sparkles },
        { key: "outreach", label: "Outreach", type: "MCP", icon: Mail },
        { key: "followup", label: "Follow-up", type: "MCP", icon: PhoneCall },
        { key: "booking", label: "Booking", type: "MCP", icon: CalendarCheck },
    ];

const STATUS_STYLES: Record<LeadJourneyStatus, string> = {
    pending: "border-zinc-800 text-zinc-500 bg-zinc-950/20",
    running:
        "border-blue-500/40 text-blue-300 bg-gradient-to-r from-blue-500/15 via-cyan-500/10 to-indigo-500/15 bg-[length:200%_200%] motion-safe:animate-shine",
    complete:
        "border-emerald-500/40 text-emerald-300 bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-emerald-500/15 bg-[length:200%_200%] motion-safe:animate-shine",
    skipped: "border-zinc-800 text-zinc-600 bg-zinc-950/10",
    error:
        "border-red-500/40 text-red-300 bg-gradient-to-r from-red-500/15 via-orange-500/10 to-rose-500/15 bg-[length:200%_200%] motion-safe:animate-shine",
};

export function LeadJourney({ journeys, runId, warnings }: LeadJourneyProps) {
    return (
        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Lead Journey</h3>
                        <p className="text-sm text-zinc-400">
                            MCP + AI pipeline visibility for each lead
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {runId && (
                            <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                                Run {runId.slice(0, 8)}
                            </Badge>
                        )}
                    </div>
                </div>

                {warnings && warnings.length > 0 && (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                        {warnings.join(" ")}
                    </div>
                )}

                {journeys.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
                        Start a lead run to see step-by-step journey status.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {journeys.map((journey) => (
                            <div key={journey.leadId} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-white">{journey.companyName}</p>
                                        <p className="text-xs text-zinc-500">
                                            {journey.founderName || "Lead"} • {journey.source || "source"} • Score {journey.score ?? 0}
                                        </p>
                                    </div>
                                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                                        ICP Fit {journey.score ?? 0}
                                    </Badge>
                                </div>

                                <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
                                    {STEP_DEFS.map((step) => {
                                        const Icon = step.icon;
                                        const status = journey.steps[step.key];
                                        return (
                                            <div
                                                key={step.key}
                                                className={cn(
                                                    "relative overflow-hidden rounded-lg border px-2 py-2 text-center text-xs transition-colors",
                                                    STATUS_STYLES[status]
                                                )}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    <Icon className="h-3 w-3" />
                                                    <span>{step.label}</span>
                                                </div>
                                                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                                    {step.type}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
