"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Activity, Mail, Users, Rocket, Globe, TrendingUp, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedList } from "@/components/ui/animated-list";
import { useAuth } from "@/components/providers/auth-provider";
import { collection, query, where, onSnapshot, doc, limit, orderBy, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

interface AnalyticsData {
    totalLeads: number;
    converted: number;
    conversionRate: number;
    emailsSent: number;
    meetingsScheduled: number;
}

interface AgentSpaceStatus {
    agentId: string;
    updatedAt?: string | null;
    source?: string | null;
    messageId?: string | null;
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
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState<AnalyticsData>({
        totalLeads: 0,
        converted: 0,
        conversionRate: 0,
        emailsSent: 0,
        meetingsScheduled: 0,
    });

    const [activities, setActivities] = useState<ActivityLog[]>([]);
    const [agentStatus, setAgentStatus] = useState<Record<string, AgentSpaceStatus>>({});
    const [agentStatusLoading, setAgentStatusLoading] = useState(false);
    const [agentStatusError, setAgentStatusError] = useState<string | null>(null);

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
                const converted = snapshot.docs.filter(d => d.data().status === 'closed').length;
                const rate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

                setAnalytics(prev => ({
                    ...prev,
                    totalLeads,
                    converted,
                    conversionRate: rate
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
            icon: Users,
            color: "text-blue-500",
            bgColor: "bg-blue-500/10",
        },
        {
            title: "Converted",
            value: loading ? "..." : analytics.converted.toLocaleString(),
            change: "+8.1%",
            icon: Mail,
            color: "text-green-500",
            bgColor: "bg-green-500/10",
        },
        {
            title: "Conversion Rate",
            value: loading ? "..." : `${analytics.conversionRate}%`,
            change: "+2.4%",
            icon: TrendingUp,
            color: "text-purple-500",
            bgColor: "bg-purple-500/10",
        },
    ];

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
                                const Icon = stat.icon;
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
                                                    <Icon className={`h-6 w-6 ${stat.color}`} />
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
                                            <Rocket className="h-8 w-8 text-blue-500" />
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
                                            <Rocket className="h-6 w-6 text-blue-500" />
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
                                            <Globe className="h-6 w-6 text-purple-500" />
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
                                                <Activity className="h-6 w-6 text-emerald-500" />
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

                        {/* Recent Activity */}
                        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
                            <CardContent className="p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                                <div className="space-y-3">
                                    <AnimatedList>
                                        {activityItems.map((item, i) => (
                                            <div key={i} className="flex items-center justify-between py-3 border-b border-zinc-900 last:border-0 w-full bg-zinc-950/50">
                                                <div className="flex items-center gap-3">
                                                    <Activity className={`h-4 w-4 ${item.color}`} />
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
