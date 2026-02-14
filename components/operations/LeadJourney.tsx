"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AfroGlyph, type AfroGlyphVariant } from "@/components/branding/AfroGlyph";
import { useAuth } from "@/components/providers/auth-provider";
import { getPlacesPhotoBlob } from "@/lib/google/places-photo-client";

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
    website?: string;
    googleMapsUrl?: string;
    websiteDomain?: string;
    domainClusterSize?: number;
    placePhotos?: Array<{
        ref: string;
        width: number;
        height: number;
        htmlAttributions?: string[];
    }>;
    steps: Record<LeadJourneyStepKey, LeadJourneyStatus>;
}

interface LeadJourneyProps {
    journeys: LeadJourneyEntry[];
    runId?: string | null;
    warnings?: string[];
    selectedLeadId?: string | null;
    onViewDetails?: (leadId: string) => void;
}

const STEP_DEFS: Array<{
    key: LeadJourneyStepKey;
    label: string;
    type: "MCP" | "AI";
    icon: AfroGlyphVariant;
}> = [
        { key: "source", label: "Source", type: "MCP", icon: "source" },
        { key: "score", label: "Score", type: "AI", icon: "score" },
        { key: "enrich", label: "Enrich", type: "MCP", icon: "enrich" },
        { key: "script", label: "Script", type: "AI", icon: "script" },
        { key: "outreach", label: "Outreach", type: "MCP", icon: "outreach" },
        { key: "followup", label: "Follow-up", type: "MCP", icon: "followup" },
        { key: "booking", label: "Booking", type: "MCP", icon: "booking" },
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

function normalizeHttpUrl(value?: string): string | null {
    const trimmed = (value || "").trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function PlacesPhotoThumb(props: { photoRef?: string; companyName: string }) {
    const { user } = useAuth();
    const [src, setSrc] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [visible, setVisible] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const photoRef = (props.photoRef || "").trim();

    useEffect(() => {
        setSrc(null);
        setFailed(false);
        setVisible(false);
    }, [photoRef]);

    useEffect(() => {
        if (!photoRef) return;
        if (visible) return;
        const el = containerRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "240px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [photoRef, visible]);

    useEffect(() => {
        if (!user) return;
        if (!photoRef) return;
        if (!visible) return;
        if (failed) return;

        const authedUser = user;
        let cancelled = false;
        let blobUrl: string | null = null;

        async function load() {
            const token = await authedUser.getIdToken();
            const blob = await getPlacesPhotoBlob({
                photoRef,
                maxWidth: 240,
                idToken: token,
            });
            blobUrl = URL.createObjectURL(blob);
            if (!cancelled) setSrc(blobUrl);
        }

        void load().catch(() => {
            if (!cancelled) setFailed(true);
        });

        return () => {
            cancelled = true;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        };
    }, [user, photoRef, visible, failed]);

    if (!photoRef) return null;

    return (
        <div ref={containerRef} className="h-10 w-10 shrink-0">
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob URL is generated at runtime (Next/Image can't optimize it).
                <img
                    src={src}
                    alt={`${props.companyName} photo`}
                    className="h-full w-full rounded-lg border border-zinc-800 object-cover"
                    loading="lazy"
                />
            ) : (
                <div className="h-full w-full animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50" />
            )}
        </div>
    );
}

export function LeadJourney({ journeys, runId, warnings, selectedLeadId, onViewDetails }: LeadJourneyProps) {
    const sortedJourneys = useMemo(() => {
        return journeys.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }, [journeys]);

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
                        {sortedJourneys.map((journey) => (
                            <div
                                key={journey.leadId}
                                className={cn(
                                    "rounded-xl border bg-zinc-900/40 p-4 space-y-3",
                                    selectedLeadId === journey.leadId
                                        ? "border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
                                        : "border-zinc-800"
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-start gap-3">
                                        <PlacesPhotoThumb
                                            photoRef={journey.placePhotos?.[0]?.ref}
                                            companyName={journey.companyName}
                                        />
                                        <div>
                                            {(() => {
                                                const href = normalizeHttpUrl(journey.website) || normalizeHttpUrl(journey.googleMapsUrl);
                                                if (!href) {
                                                    return <p className="text-sm font-semibold text-white">{journey.companyName}</p>;
                                                }
                                                return (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-sm font-semibold text-white hover:underline underline-offset-4"
                                                        title="Open lead website"
                                                    >
                                                        {journey.companyName}
                                                    </a>
                                                );
                                            })()}
                                            <p className="text-xs text-zinc-500">
                                                {journey.founderName || "Lead"} • {journey.source || "source"} • Score {journey.score ?? 0}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                                            ICP Fit {journey.score ?? 0}
                                        </Badge>
                                        {journey.websiteDomain && journey.domainClusterSize && journey.domainClusterSize > 1 && (
                                            <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                                                {journey.websiteDomain} x{journey.domainClusterSize}
                                            </Badge>
                                        )}
                                        {normalizeHttpUrl(journey.website) && (
                                            <Button
                                                asChild
                                                size="sm"
                                                variant="outline"
                                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                                            >
                                                <a href={normalizeHttpUrl(journey.website) as string} target="_blank" rel="noreferrer">
                                                    <AfroGlyph variant="network" className="mr-1 h-3.5 w-3.5" />
                                                    Site
                                                </a>
                                            </Button>
                                        )}
                                        {normalizeHttpUrl(journey.googleMapsUrl) && (
                                            <Button
                                                asChild
                                                size="sm"
                                                variant="outline"
                                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                                            >
                                                <a href={normalizeHttpUrl(journey.googleMapsUrl) as string} target="_blank" rel="noreferrer">
                                                    <AfroGlyph variant="trend" className="mr-1 h-3.5 w-3.5" />
                                                    Maps
                                                </a>
                                            </Button>
                                        )}
                                        {onViewDetails && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                                                onClick={() => onViewDetails(journey.leadId)}
                                            >
                                                <AfroGlyph variant="receipt" className="mr-1 h-3.5 w-3.5" />
                                                Details
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
                                    {STEP_DEFS.map((step) => {
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
                                                    <AfroGlyph variant={step.icon} className="h-3 w-3" />
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
