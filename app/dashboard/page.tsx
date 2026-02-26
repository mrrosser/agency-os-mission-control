"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedList } from "@/components/ui/animated-list";
import { AfroGlyph, type AfroGlyphVariant } from "@/components/branding/AfroGlyph";
import { useAuth } from "@/components/providers/auth-provider";
import { collection, query, where, onSnapshot, doc, limit, orderBy, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { isDepositStage, isMeetingStage, isWonStage } from "@/lib/revenue/offers";

interface AnalyticsData {
    totalLeads: number;
    converted: number;
    conversionRate: number;
    emailsSent: number;
    meetingsScheduled: number;
    depositsCollected: number;
    pipelineValue: number;
}

interface WeeklyKpiSnapshot {
    timeZone: string;
    weekStartDate: string | null;
    weekEndDate: string | null;
    generatedAt: string | null;
    summary: {
        leadsSourced: number;
        meetingsBooked: number;
        depositsCollected: number;
        dealsWon: number;
        closeRatePct: number;
        pipelineValueUsd: number;
    };
    decisionSummary: {
        scale: number;
        fix: number;
        kill: number;
        watch: number;
    };
}

interface AgentSpaceStatus {
    agentId: string;
    updatedAt?: string | null;
    source?: string | null;
    messageId?: string | null;
}

interface PosWorkerStatusSnapshot {
    generatedAt: string;
    uid: string;
    policy: {
        allowSideEffects: boolean;
        autoApproveLowRisk: boolean;
        requireApprovalForHighRisk: boolean;
    };
    summary: {
        health: "operational" | "degraded" | "offline";
        detail: string;
        queuedEvents: number;
        processingEvents: number;
        blockedEvents: number;
        deadLetterEvents: number;
        completedEvents: number;
        oldestPendingSeconds: number;
        outboxQueued: number;
        lastWebhookAt: string | null;
        lastProcessedAt: string | null;
        lastRunAt: string | null;
    };
}

interface ActivityLog {
    id: string;
    action?: string;
    details?: string | null;
    type?: string | null;
    timestamp?: Timestamp | null;
}

export default function DashboardPage() {
    const { user } = useAuth();
    const router = useRouter();
    const internalRevenueUiEnabled = process.env.NEXT_PUBLIC_ENABLE_INTERNAL_REVENUE_UI === "true";
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState<AnalyticsData>({
        totalLeads: 0,
        converted: 0,
        conversionRate: 0,
        emailsSent: 0,
        meetingsScheduled: 0,
        depositsCollected: 0,
        pipelineValue: 0,
    });

    const [activities, setActivities] = useState<ActivityLog[]>([]);
    const [agentStatus, setAgentStatus] = useState<Record<string, AgentSpaceStatus>>({});
    const [agentStatusLoading, setAgentStatusLoading] = useState(false);
    const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
    const [weeklyKpi, setWeeklyKpi] = useState<WeeklyKpiSnapshot | null>(null);
    const [weeklyKpiLoading, setWeeklyKpiLoading] = useState(false);
    const [weeklyKpiError, setWeeklyKpiError] = useState<string | null>(null);
    const [posStatus, setPosStatus] = useState<PosWorkerStatusSnapshot | null>(null);
    const [posStatusLoading, setPosStatusLoading] = useState(false);
    const [posStatusError, setPosStatusError] = useState<string | null>(null);

    const fetchAgentStatus = useCallback(async () => {
        if (!user) return;
        setAgentStatusLoading(true);
        setAgentStatusError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/agents/status", {
                method: "GET",
                headers,
            });
            const payload = await readApiJson<{ spaces?: Record<string, AgentSpaceStatus>; error?: string }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                throw new Error(
                    payload?.error ||
                    `Failed to load agent routing status (status ${response.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setAgentStatus(payload?.spaces || {});
        } catch (error: unknown) {
            setAgentStatusError(error instanceof Error ? error.message : "Unable to load agent status");
        } finally {
            setAgentStatusLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!user) return;
        fetchAgentStatus();
    }, [user, fetchAgentStatus]);

    const fetchWeeklyKpi = useCallback(async () => {
        if (!user || !internalRevenueUiEnabled) return;
        setWeeklyKpiLoading(true);
        setWeeklyKpiError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/revenue/kpi/latest", {
                method: "GET",
                headers,
            });
            const payload = await readApiJson<{
                ok?: boolean;
                report?: WeeklyKpiSnapshot | null;
                error?: string;
            }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                throw new Error(
                    payload?.error ||
                    `Failed to load weekly KPI snapshot (status ${response.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setWeeklyKpi(payload?.report || null);
        } catch (error: unknown) {
            setWeeklyKpiError(error instanceof Error ? error.message : "Unable to load weekly KPI snapshot");
        } finally {
            setWeeklyKpiLoading(false);
        }
    }, [internalRevenueUiEnabled, user]);

    useEffect(() => {
        if (!user || !internalRevenueUiEnabled) return;
        fetchWeeklyKpi();
    }, [fetchWeeklyKpi, internalRevenueUiEnabled, user]);

    const fetchPosStatus = useCallback(async () => {
        if (!user || !internalRevenueUiEnabled) return;
        setPosStatusLoading(true);
        setPosStatusError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/revenue/pos/status", {
                method: "GET",
                headers,
            });
            const payload = await readApiJson<{
                ok?: boolean;
                snapshot?: PosWorkerStatusSnapshot;
                error?: string;
            }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                throw new Error(
                    payload?.error ||
                    `Failed to load POS worker status (status ${response.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setPosStatus(payload?.snapshot || null);
        } catch (error: unknown) {
            setPosStatusError(error instanceof Error ? error.message : "Unable to load POS worker status");
        } finally {
            setPosStatusLoading(false);
        }
    }, [internalRevenueUiEnabled, user]);

    useEffect(() => {
        if (!user || !internalRevenueUiEnabled) return;
        fetchPosStatus();
    }, [fetchPosStatus, internalRevenueUiEnabled, user]);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        // 1. Real-time analytics doc listener (Primary)
        const unsubscribeAnalytics = onSnapshot(
            doc(db, "analytics", user.uid),
            (snapshot) => {
                if (snapshot.exists()) {
                    setAnalytics(snapshot.data() as AnalyticsData);
                }
                // Don't set loading false here yet, wait for leads/activities if empty
            }
        );

        // 2. Real-time leads calculation (Secondary/Live)
        const unsubscribeLeads = onSnapshot(
            query(collection(db, "leads"), where("userId", "==", user.uid)),
            (snapshot) => {
                const totalLeads = snapshot.size;
                let converted = 0;
                let meetingsScheduled = 0;
                let depositsCollected = 0;
                let pipelineValue = 0;

                for (const docSnap of snapshot.docs) {
                    const data = docSnap.data();
                    const stage = data.pipelineStage || data.status;
                    if (isWonStage(stage)) converted += 1;
                    if (isMeetingStage(stage)) meetingsScheduled += 1;
                    if (isDepositStage(stage)) depositsCollected += 1;
                    const value = Number(data.value || 0);
                    if (Number.isFinite(value)) pipelineValue += value;
                }
                const rate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

                setAnalytics(prev => ({
                    ...prev,
                    totalLeads,
                    converted,
                    conversionRate: rate,
                    meetingsScheduled,
                    depositsCollected,
                    pipelineValue,
                }));
            }
        );

        // 3. Real-time activity logs
        const unsubscribeActivities = onSnapshot(
            query(
                collection(db, "activities"),
                where("userId", "==", user.uid),
                orderBy("timestamp", "desc"),
                limit(10)
            ),
            (snapshot) => {
                const logs: ActivityLog[] = snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<ActivityLog, "id">),
                }));
                setActivities(logs);

                // Update email count from logs
                const emailCount = logs.filter((log) => log.type === 'email').length;
                setAnalytics(prev => ({
                    ...prev,
                    emailsSent: emailCount
                }));

                setLoading(false);
            }
        );

        return () => {
            unsubscribeAnalytics();
            unsubscribeLeads();
            unsubscribeActivities();
        };

    }, [user]);

    const stats = [
        {
            title: "Total Leads",
            value: loading ? "..." : analytics.totalLeads.toLocaleString(),
            change: "+12.3%",
            icon: "people" as AfroGlyphVariant,
            color: "text-blue-500",
            bgColor: "bg-blue-500/10",
        },
        {
            title: "Converted (Won/Deposit)",
            value: loading ? "..." : analytics.converted.toLocaleString(),
            change: "+8.1%",
            icon: "inbox" as AfroGlyphVariant,
            color: "text-green-500",
            bgColor: "bg-green-500/10",
        },
        {
            title: "Conversion Rate",
            value: loading ? "..." : `${analytics.conversionRate}%`,
            change: "+2.4%",
            icon: "trend" as AfroGlyphVariant,
            color: "text-purple-500",
            bgColor: "bg-purple-500/10",
        },
    ];

    const revenueStats = [
        {
            title: "Meetings Booked",
            value: loading ? "..." : analytics.meetingsScheduled.toLocaleString(),
            icon: "mission" as AfroGlyphVariant,
            color: "text-cyan-300",
            bgColor: "bg-cyan-500/10",
        },
        {
            title: "Deposits Collected",
            value: loading ? "..." : analytics.depositsCollected.toLocaleString(),
            icon: "activity" as AfroGlyphVariant,
            color: "text-emerald-300",
            bgColor: "bg-emerald-500/10",
        },
        {
            title: "Pipeline Value",
            value: loading ? "..." : `$${Math.round(analytics.pipelineValue).toLocaleString()}`,
            icon: "trend" as AfroGlyphVariant,
            color: "text-amber-300",
            bgColor: "bg-amber-500/10",
        },
    ];

    const weeklyKpiStats = weeklyKpi
        ? [
            {
                title: "Weekly Leads",
                value: weeklyKpi.summary.leadsSourced.toLocaleString(),
                icon: "people" as AfroGlyphVariant,
                color: "text-cyan-300",
                bgColor: "bg-cyan-500/10",
            },
            {
                title: "Weekly Deposits",
                value: weeklyKpi.summary.depositsCollected.toLocaleString(),
                icon: "activity" as AfroGlyphVariant,
                color: "text-emerald-300",
                bgColor: "bg-emerald-500/10",
            },
            {
                title: "Weekly Close Rate",
                value: `${weeklyKpi.summary.closeRatePct.toFixed(1)}%`,
                icon: "trend" as AfroGlyphVariant,
                color: "text-amber-300",
                bgColor: "bg-amber-500/10",
            },
        ]
        : [];

    const weeklyKpiLabel =
        weeklyKpi?.weekStartDate && weeklyKpi?.weekEndDate
            ? `${weeklyKpi.weekStartDate} - ${weeklyKpi.weekEndDate}`
            : "No report window";

    const posHealthColor =
        posStatus?.summary.health === "operational"
            ? "text-emerald-300"
            : posStatus?.summary.health === "degraded"
                ? "text-amber-300"
                : "text-red-300";
    const posHealthLabel =
        posStatus?.summary.health === "operational"
            ? "Operational"
            : posStatus?.summary.health === "degraded"
                ? "Degraded"
                : "Offline";

    const activityItems = activities.length > 0 ? activities.map(activity => ({
        action: activity.action,
        count: activity.details || "—",
        time: activity.timestamp ? new Date(activity.timestamp.toDate()).toLocaleTimeString() : "Just now",
        color: activity.type === 'email' ? "text-green-500" :
            activity.type === 'meeting' ? "text-blue-500" :
                activity.type === 'lead' ? "text-purple-500" : "text-zinc-500"
    })) : [
        {
            action: "No recent activity",
            count: "0",
            time: "—",
            color: "text-zinc-500"
        }
    ];

    const spaceLabels: Record<string, string> = {
        "spaces/AAQA62xqRGQ": "Outreach",
        "spaces/AAQALocqO7Q": "Coding/Infra",
    };

    const agentStatusItems = Object.entries(agentStatus).map(([spaceId, status]) => ({
        spaceId,
        label: spaceLabels[spaceId] || spaceId,
        agentId: status.agentId,
        updatedAt: status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "No activity yet",
    }));

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header */}
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold text-white">Leadflow Status</h1>
                    <p className="text-zinc-400">
                        Real-time lead sourcing, outreach, and conversion performance
                    </p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : (
                    <>
                        {/* Stats Grid */}
                        <div className="grid gap-6 md:grid-cols-3">
                            {stats.map((stat, i) => {
                                return (
                                    <Card key={i} className="bg-zinc-950 border-zinc-800 shadow-lg group hover:border-blue-500/50 transition-all duration-300">
                                        <CardContent className="p-6">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-1">
                                                    <p className="text-sm font-medium text-zinc-400">{stat.title}</p>
                                                    <p className="text-3xl font-bold text-white tracking-tight">{stat.value}</p>
                                                    <p className="text-xs text-green-500">{stat.change} from last month</p>
                                                </div>
                                                <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                                                    <AfroGlyph variant={stat.icon} className={`h-6 w-6 ${stat.color}`} />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>

                        {analytics.totalLeads === 0 && !loading && (
                            <Card className="bg-blue-500/5 border-blue-500/20 border-dashed border-2">
                                <CardContent className="p-8 text-center space-y-4">
                                    <div className="flex justify-center">
                                        <div className="p-3 rounded-full bg-blue-500/10">
                                            <AfroGlyph variant="mission" className="h-8 w-8 text-blue-500" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-xl font-bold text-white">Lead Engine Ready?</h3>
                                        <p className="text-zinc-400 max-w-sm mx-auto">
                                            Your lead command center is online. Configure your profile and API keys to launch your first lead run.
                                        </p>
                                    </div>
                                    <Button
                                        onClick={() => router.push("/dashboard/settings")}
                                        className="bg-blue-600 hover:bg-blue-500 text-white"
                                    >
                                        Configure Lead Profile
                                    </Button>
                                </CardContent>
                            </Card>
                        )}

                        {/* Activity Cards */}
                        <div className="grid gap-6 md:grid-cols-3">
                            <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                                <CardContent className="p-6">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-blue-500/10 shrink-0">
                                            <AfroGlyph variant="operations" className="h-6 w-6 text-blue-500" />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="font-semibold text-white">Active Lead Runs</h3>
                                            <p className="text-sm text-zinc-400">
                                                Google Workspace + Outreach APIs Active
                                            </p>
                                            <div className="mt-3 h-2 bg-zinc-900 rounded-full overflow-hidden">
                                                <div className="h-full w-[85%] bg-blue-500 animate-pulse"></div>
                                            </div>
                                            <p className="text-xs text-zinc-500 mt-2">
                                                Calendar • Gmail • Drive • Ready
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                                <CardContent className="p-6">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-purple-500/10 shrink-0">
                                            <AfroGlyph variant="network" className="h-6 w-6 text-purple-500" />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="font-semibold text-white">Platform Status</h3>
                                            <p className="text-sm text-zinc-400">
                                                All systems operational
                                            </p>
                                            <div className="mt-3 flex items-center gap-2">
                                                <div className="flex -space-x-2">
                                                    {["📧", "📅", "📁", "🔐"].map((emoji, i) => (
                                                        <div
                                                            key={i}
                                                            className="h-8 w-8 rounded-full bg-zinc-900 border-2 border-zinc-950 flex items-center justify-center text-sm"
                                                        >
                                                            {emoji}
                                                        </div>
                                                    ))}
                                                </div>
                                                <span className="text-xs text-green-500 font-medium">● Online</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                                <CardContent className="p-6">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 rounded-lg bg-emerald-500/10 shrink-0">
                                                <AfroGlyph variant="activity" className="h-6 w-6 text-emerald-500" />
                                            </div>
                                            <div className="space-y-1">
                                                <h3 className="font-semibold text-white">Agent Routing</h3>
                                                <p className="text-sm text-zinc-400">
                                                    Latest agent handling per space
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={fetchAgentStatus}
                                            variant="outline"
                                            size="sm"
                                            className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                                            disabled={agentStatusLoading}
                                        >
                                            Refresh
                                        </Button>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        {agentStatusLoading && (
                                            <p className="text-xs text-zinc-500">Loading routing status...</p>
                                        )}
                                        {agentStatusError && (
                                            <p className="text-xs text-red-400">{agentStatusError}</p>
                                        )}
                                        {!agentStatusLoading && agentStatusItems.length === 0 && (
                                            <p className="text-xs text-zinc-500">No routing activity yet.</p>
                                        )}
                                        {agentStatusItems.map((item) => (
                                            <div key={item.spaceId} className="flex items-center justify-between gap-4">
                                                <div>
                                                    <p className="text-sm text-white font-medium">{item.label}</p>
                                                    <p className="text-xs text-zinc-500">{item.spaceId}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-zinc-400">{item.agentId}</p>
                                                    <p className="text-xs text-zinc-500">{item.updatedAt}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {internalRevenueUiEnabled && (
                            <div className="space-y-6">
                                <div className="grid gap-6 md:grid-cols-3">
                                    {revenueStats.map((stat) => (
                                        <Card key={stat.title} className="bg-zinc-950 border-zinc-800 shadow-lg">
                                            <CardContent className="p-6">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-1">
                                                        <p className="text-sm font-medium text-zinc-400">{stat.title}</p>
                                                        <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>
                                                    </div>
                                                    <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                                                        <AfroGlyph variant={stat.icon} className={`h-6 w-6 ${stat.color}`} />
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>

                                <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                                    <CardContent className="p-6 space-y-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-1">
                                                <h3 className="text-lg font-semibold text-white">Weekly Revenue KPI</h3>
                                                <p className="text-sm text-zinc-400">
                                                    {weeklyKpiLabel}
                                                </p>
                                            </div>
                                            <Button
                                                onClick={fetchWeeklyKpi}
                                                variant="outline"
                                                size="sm"
                                                className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                                                disabled={weeklyKpiLoading}
                                            >
                                                Refresh
                                            </Button>
                                        </div>

                                        {weeklyKpiLoading && (
                                            <p className="text-xs text-zinc-500">Loading weekly KPI snapshot...</p>
                                        )}

                                        {weeklyKpiError && (
                                            <p className="text-xs text-red-400">{weeklyKpiError}</p>
                                        )}

                                        {!weeklyKpiLoading && !weeklyKpiError && weeklyKpiStats.length === 0 && (
                                            <p className="text-xs text-zinc-500">
                                                No weekly KPI report found yet. Run `/api/revenue/kpi/weekly` to initialize.
                                            </p>
                                        )}

                                        {weeklyKpiStats.length > 0 && (
                                            <>
                                                <div className="grid gap-4 md:grid-cols-3">
                                                    {weeklyKpiStats.map((stat) => (
                                                        <div key={stat.title} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-zinc-500">{stat.title}</p>
                                                                    <p className="text-xl font-semibold text-white">{stat.value}</p>
                                                                </div>
                                                                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                                                                    <AfroGlyph variant={stat.icon} className={`h-5 w-5 ${stat.color}`} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-xs text-zinc-500">
                                                    Decisions: scale {weeklyKpi?.decisionSummary.scale || 0}, fix {weeklyKpi?.decisionSummary.fix || 0}, kill {weeklyKpi?.decisionSummary.kill || 0}, watch {weeklyKpi?.decisionSummary.watch || 0}
                                                </p>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                                    <CardContent className="p-6 space-y-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-1">
                                                <h3 className="text-lg font-semibold text-white">POS Worker Status</h3>
                                                <p className="text-sm text-zinc-400">
                                                    Deterministic Square event ingestion and action queue health
                                                </p>
                                            </div>
                                            <Button
                                                onClick={fetchPosStatus}
                                                variant="outline"
                                                size="sm"
                                                className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                                                disabled={posStatusLoading}
                                            >
                                                Refresh
                                            </Button>
                                        </div>

                                        {posStatusLoading && (
                                            <p className="text-xs text-zinc-500">Loading POS worker status...</p>
                                        )}

                                        {posStatusError && (
                                            <p className="text-xs text-red-400">{posStatusError}</p>
                                        )}

                                        {!posStatusLoading && !posStatusError && !posStatus && (
                                            <p className="text-xs text-zinc-500">
                                                No POS worker status available yet.
                                            </p>
                                        )}

                                        {posStatus && (
                                            <>
                                                <div className="flex flex-wrap items-center gap-3 text-sm">
                                                    <span className={`font-medium ${posHealthColor}`}>● {posHealthLabel}</span>
                                                    <span className="text-zinc-500">Queued {posStatus.summary.queuedEvents}</span>
                                                    <span className="text-zinc-500">Blocked {posStatus.summary.blockedEvents}</span>
                                                    <span className="text-zinc-500">Dead-letter {posStatus.summary.deadLetterEvents}</span>
                                                    <span className="text-zinc-500">Outbox queued {posStatus.summary.outboxQueued}</span>
                                                </div>

                                                <p className="text-xs text-zinc-400">{posStatus.summary.detail}</p>

                                                <div className="grid gap-3 md:grid-cols-3">
                                                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                                                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Last Webhook</p>
                                                        <p className="mt-1 text-sm text-white">
                                                            {posStatus.summary.lastWebhookAt
                                                                ? new Date(posStatus.summary.lastWebhookAt).toLocaleString()
                                                                : "Never"}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                                                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Last Processed</p>
                                                        <p className="mt-1 text-sm text-white">
                                                            {posStatus.summary.lastProcessedAt
                                                                ? new Date(posStatus.summary.lastProcessedAt).toLocaleString()
                                                                : "Never"}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                                                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Last Worker Run</p>
                                                        <p className="mt-1 text-sm text-white">
                                                            {posStatus.summary.lastRunAt
                                                                ? new Date(posStatus.summary.lastRunAt).toLocaleString()
                                                                : "Never"}
                                                        </p>
                                                    </div>
                                                </div>

                                                <p className="text-xs text-zinc-500">
                                                    Policy: side-effects {posStatus.policy.allowSideEffects ? "on" : "off"}, low-risk auto-approve{" "}
                                                    {posStatus.policy.autoApproveLowRisk ? "on" : "off"}, high-risk approval required{" "}
                                                    {posStatus.policy.requireApprovalForHighRisk ? "on" : "off"}.
                                                </p>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Recent Activity */}
                        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                            <CardContent className="p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                                <div className="space-y-3">
                                    <AnimatedList>
                                        {activityItems.map((item, i) => (
                                            <div key={i} className="flex items-center justify-between py-3 border-b border-zinc-900 last:border-0 w-full bg-zinc-950/50">
                                                <div className="flex items-center gap-3">
                                                    <AfroGlyph variant="activity" className={`h-4 w-4 ${item.color}`} />
                                                    <span className="text-sm text-white">{item.action}</span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className={`text-sm font-semibold ${item.color}`}>{item.count}</span>
                                                    <span className="text-xs text-zinc-500">{item.time}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </AnimatedList>
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>
        </div>
    );
}
