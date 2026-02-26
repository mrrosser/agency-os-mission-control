"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, Bot, Radar, Shield, Activity, Sparkles } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Health = "operational" | "degraded" | "offline";
type RuntimeState = "active" | "idle" | "degraded" | "inactive";
type BillingStatus = "live" | "missing_credentials" | "unauthorized" | "unavailable" | "error";
type TimelineFilter = "all" | "tasks" | "comments" | "status" | "decisions";

interface AgentSnapshot {
  id: string;
  label: string;
  role: string;
  businessId: string | null;
  state: RuntimeState;
  lastSeenAt: string | null;
  channels: string[];
  estimatedMonthlyCostUsd: number;
  blockedBy: string[];
}

interface ServiceSnapshot {
  id: string;
  label: string;
  state: Health;
  detail: string;
  required: boolean;
  monthlyCostUsd: number;
}

interface SkillSnapshot {
  id: string;
  label: string;
  state: Health;
  detail: string;
}

interface DiagnosticBug {
  fingerprint: string;
  count: number;
  message: string;
  route: string;
  triageStatus: string;
  triageIssueUrl: string | null;
  lastSeenAt: string | null;
}

interface DiagnosticAlert {
  alertId: string;
  runId: string;
  title: string;
  message: string;
  status: "open" | "acked";
  severity: string;
  createdAt: string | null;
}

interface ControlPlaneSnapshot {
  generatedAt: string;
  summary: {
    health: Health;
    activeAgents: number;
    degradedAgents: number;
    inactiveAgents: number;
    openAlerts: number;
    unresolvedBugs: number;
    projectedMonthlyCostUsd: number;
  };
  quota: {
    orgId: string;
    runsUsed: number;
    maxRunsPerDay: number;
    leadsUsed: number;
    maxLeadsPerDay: number;
    activeRuns: number;
    maxActiveRuns: number;
  };
  agents: AgentSnapshot[];
  services: ServiceSnapshot[];
  skills: SkillSnapshot[];
  diagnostics: {
    bugs: DiagnosticBug[];
    alerts: DiagnosticAlert[];
    recommendations: string[];
  };
  operations: {
    queueHealth: {
      state: Health;
      degradedChecks: number;
      offlineChecks: number;
      checks: Array<{
        id: string;
        label: string;
        state: Health;
        detail: string;
      }>;
    };
    socialDispatch: {
      state: Health;
      pendingApproval: number;
      pendingExternalTool: number;
      failedDispatch: number;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
    };
    revenueKpi: {
      state: Health;
      weekStartDate: string | null;
      weekEndDate: string | null;
      generatedAt: string | null;
      leadsSourced: number;
      closeRatePct: number;
      depositsCollected: number;
      dealsWon: number;
      pipelineValueUsd: number;
      decisionSummary: {
        scale: number;
        fix: number;
        kill: number;
        watch: number;
      };
    };
    posWorker: {
      state: Health;
      detail: string;
      queuedEvents: number;
      blockedEvents: number;
      deadLetterEvents: number;
      outboxQueued: number;
      oldestPendingSeconds: number;
      lastWebhookAt: string | null;
    };
  };
  costModel: {
    method: string;
    assumptions: string[];
    serviceCostUsd: number;
    agentCostUsd: number;
    liveProviderCostUsd: number;
    providerBilling: Array<{
      providerId: string;
      label: string;
      status: BillingStatus;
      monthlyCostUsd: number | null;
      currency: string | null;
      detail: string;
      source: string;
    }>;
  };
}

type ActivityKind = "heartbeat" | "alert" | "bug" | "decision";

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  timeline: Exclude<TimelineFilter, "all">;
  title: string;
  detail: string;
  ts: number;
}

const HEALTH_BADGE: Record<Health, string> = {
  operational: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  degraded: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  offline: "border-rose-400/40 bg-rose-400/10 text-rose-200",
};

const RUNTIME_BADGE: Record<RuntimeState, string> = {
  active: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
  idle: "border-blue-400/40 bg-blue-400/10 text-blue-200",
  degraded: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  inactive: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};

const BILLING_BADGE: Record<BillingStatus, string> = {
  live: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  missing_credentials: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  unauthorized: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  unavailable: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  error: "border-rose-500/40 bg-rose-500/10 text-rose-200",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "No heartbeat yet";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function quotaPct(used: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
}

function costMethodLabel(method: string): string {
  if (method === "live-v1") return "Live provider billing";
  if (method === "hybrid-v1") return "Hybrid (live + fallback)";
  return "Heuristic monthly estimate";
}

function toTs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultRouteTarget(agent: AgentSnapshot): string {
  if (agent.channels.length > 0) return agent.channels[0];
  if (agent.businessId) return `business:${agent.businessId}`;
  return "mkt-social";
}

export default function AgentNexusPage() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [agentActionState, setAgentActionState] = useState<Record<string, boolean>>({});
  const [agentActionFeedback, setAgentActionFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (!user) return;
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/agents/control-plane", { method: "GET", headers });
      const payload = await readApiJson<ControlPlaneSnapshot & { error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Control plane request failed (${response.status}${cid ? ` cid=${cid}` : ""})`);
      }
      setSnapshot(payload);
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load control plane snapshot");
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "refresh") setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void loadSnapshot("initial");
  }, [user, loadSnapshot]);

  const serviceOperationalCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.services.filter((service) => service.state === "operational").length;
  }, [snapshot]);

  const liveFeed = useMemo(() => {
    if (!snapshot) return [];

    const items: ActivityItem[] = [];

    for (const agent of snapshot.agents) {
      if (!agent.lastSeenAt) continue;
      items.push({
        id: `heartbeat:${agent.id}:${agent.lastSeenAt}`,
        kind: "heartbeat",
        timeline: "status",
        title: `${agent.label} heartbeat`,
        detail: agent.channels.length > 0 ? `Channels: ${agent.channels.join(", ")}` : "No active channels",
        ts: toTs(agent.lastSeenAt),
      });
    }

    for (const alert of snapshot.diagnostics.alerts) {
      items.push({
        id: `alert:${alert.alertId}`,
        kind: "alert",
        timeline: "tasks",
        title: alert.title,
        detail: `${alert.status.toUpperCase()} • ${alert.message}`,
        ts: toTs(alert.createdAt),
      });
    }

    for (const bug of snapshot.diagnostics.bugs) {
      items.push({
        id: `bug:${bug.fingerprint}`,
        kind: "bug",
        timeline: "comments",
        title: bug.message || bug.route || bug.fingerprint,
        detail: `${bug.count} hits • ${bug.triageStatus}`,
        ts: toTs(bug.lastSeenAt),
      });
    }

    for (const [index, recommendation] of snapshot.diagnostics.recommendations.entries()) {
      items.push({
        id: `decision:${index}`,
        kind: "decision",
        timeline: "decisions",
        title: "Control-plane recommendation",
        detail: recommendation,
        ts: toTs(snapshot.generatedAt) - index,
      });
    }

    return items.sort((a, b) => b.ts - a.ts).slice(0, 20);
  }, [snapshot]);

  const liveFeedCounts = useMemo(() => {
    return {
      all: liveFeed.length,
      tasks: liveFeed.filter((item) => item.timeline === "tasks").length,
      comments: liveFeed.filter((item) => item.timeline === "comments").length,
      status: liveFeed.filter((item) => item.timeline === "status").length,
      decisions: liveFeed.filter((item) => item.timeline === "decisions").length,
    };
  }, [liveFeed]);

  const filteredLiveFeed = useMemo(() => {
    if (timelineFilter === "all") return liveFeed;
    return liveFeed.filter((item) => item.timeline === timelineFilter);
  }, [liveFeed, timelineFilter]);

  const runAgentAction = useCallback(
    async (agent: AgentSnapshot, action: "pause" | "ping" | "route") => {
      if (!user) return;
      const actionKey = `${agent.id}:${action}`;
      setAgentActionState((prev) => ({ ...prev, [actionKey]: true }));
      setAgentActionFeedback(null);
      try {
        const headers = await buildAuthHeaders(user);
        const body: {
          agentId: string;
          action: "pause" | "ping" | "route";
          target?: string;
          idempotencyKey: string;
        } = {
          agentId: agent.id,
          action,
          idempotencyKey: `agent:${agent.id}:${action}:${Math.floor(Date.now() / 15000)}`,
        };
        if (action === "route") {
          body.target = defaultRouteTarget(agent);
        }

        const response = await fetch("/api/agents/actions", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const payload = await readApiJson<{ error?: string; requestId?: string; replayed?: boolean }>(response);
        if (!response.ok) {
          const cid = getResponseCorrelationId(response);
          throw new Error(payload?.error || `Action failed (${response.status}${cid ? ` cid=${cid}` : ""})`);
        }
        const replayed = payload?.replayed ? " (replayed)" : "";
        setAgentActionFeedback(
          `${agent.label}: queued ${action}${action === "route" ? ` -> ${body.target}` : ""}${replayed}`
        );
      } catch (actionError: unknown) {
        setAgentActionFeedback(
          actionError instanceof Error ? actionError.message : `Failed to queue ${action} action for ${agent.label}`
        );
      } finally {
        setAgentActionState((prev) => ({ ...prev, [actionKey]: false }));
      }
    },
    [user]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-black p-6 md:p-8">
        <div className="max-w-7xl mx-auto flex items-center justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#03040a] p-6 md:p-8 text-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-[#0a1021] via-[#090b16] to-[#140a1d] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(6,182,212,0.18),transparent_40%),radial-gradient(circle_at_90%_10%,rgba(236,72,153,0.12),transparent_35%),radial-gradient(circle_at_40%_90%,rgba(14,165,233,0.12),transparent_45%)]" />
          <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                <Radar className="h-3.5 w-3.5" />
                Agent Control Plane
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Agent Nexus</h1>
              <p className="max-w-3xl text-sm text-zinc-300">
                Live view of agent runtime state, integration health, bug pressure, and projected monthly cost.
                Runs locally at <span className="font-semibold text-cyan-200">/dashboard/agents</span>.
              </p>
              {snapshot && (
                <p className="text-xs text-zinc-400">Last snapshot: {formatTimestamp(snapshot.generatedAt)}</p>
              )}
            </div>
            <Button
              onClick={() => void loadSnapshot("refresh")}
              variant="outline"
              className="border-cyan-400/40 bg-black/30 text-cyan-100 hover:bg-cyan-400/10"
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh Snapshot
            </Button>
          </div>
          {error && (
            <div className="relative z-10 mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          {agentActionFeedback && (
            <div className="relative z-10 mt-3 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100">
              {agentActionFeedback}
            </div>
          )}
        </section>

        {snapshot && (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <Card className="border-cyan-500/20 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">System Health</p>
                    <Shield className="h-4 w-4 text-cyan-300" />
                  </div>
                  <Badge className={HEALTH_BADGE[snapshot.summary.health]}>{snapshot.summary.health}</Badge>
                  <p className="text-xs text-zinc-400">
                    {snapshot.summary.activeAgents} active • {snapshot.summary.degradedAgents} degraded
                  </p>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/20 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Services</p>
                    <Activity className="h-4 w-4 text-cyan-300" />
                  </div>
                  <p className="text-2xl font-semibold">
                    {serviceOperationalCount}/{snapshot.services.length}
                  </p>
                  <p className="text-xs text-zinc-400">Operational integrations</p>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/20 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Bug Pressure</p>
                    <AlertTriangle className="h-4 w-4 text-cyan-300" />
                  </div>
                  <p className="text-2xl font-semibold">{snapshot.summary.unresolvedBugs}</p>
                  <p className="text-xs text-zinc-400">{snapshot.summary.openAlerts} open alert(s)</p>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/20 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Projected Cost</p>
                    <Sparkles className="h-4 w-4 text-cyan-300" />
                  </div>
                  <p className="text-2xl font-semibold">${snapshot.summary.projectedMonthlyCostUsd.toFixed(2)}</p>
                  <p className="text-xs text-zinc-400">{costMethodLabel(snapshot.costModel.method)}</p>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">POS Worker</p>
                    <Badge className={HEALTH_BADGE[snapshot.operations.posWorker.state]}>
                      {snapshot.operations.posWorker.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-300">{snapshot.operations.posWorker.detail}</p>
                  <p className="text-xs text-zinc-500">
                    Queue {snapshot.operations.posWorker.queuedEvents} • Blocked {snapshot.operations.posWorker.blockedEvents} • Dead-letter{" "}
                    {snapshot.operations.posWorker.deadLetterEvents}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Outbox {snapshot.operations.posWorker.outboxQueued} • Oldest pending {snapshot.operations.posWorker.oldestPendingSeconds}s
                  </p>
                  <p className="text-xs text-zinc-500">
                    Last webhook: {formatTimestamp(snapshot.operations.posWorker.lastWebhookAt)}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Social Dispatch</p>
                    <Badge className={HEALTH_BADGE[snapshot.operations.socialDispatch.state]}>
                      {snapshot.operations.socialDispatch.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Pending approvals {snapshot.operations.socialDispatch.pendingApproval} • Queue pending{" "}
                    {snapshot.operations.socialDispatch.pendingExternalTool}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Failed dispatch {snapshot.operations.socialDispatch.failedDispatch}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Last success: {formatTimestamp(snapshot.operations.socialDispatch.lastSuccessAt)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Last failure: {formatTimestamp(snapshot.operations.socialDispatch.lastFailureAt)}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Queue Health</p>
                    <Badge className={HEALTH_BADGE[snapshot.operations.queueHealth.state]}>
                      {snapshot.operations.queueHealth.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Offline {snapshot.operations.queueHealth.offlineChecks} • Degraded {snapshot.operations.queueHealth.degradedChecks}
                  </p>
                  <div className="space-y-1">
                    {snapshot.operations.queueHealth.checks.map((check) => (
                      <p key={check.id} className="text-xs text-zinc-400">
                        <span className="text-zinc-200">{check.label}</span>: {check.state}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Revenue KPI</p>
                    <Badge className={HEALTH_BADGE[snapshot.operations.revenueKpi.state]}>
                      {snapshot.operations.revenueKpi.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Week: {snapshot.operations.revenueKpi.weekStartDate || "n/a"} -{" "}
                    {snapshot.operations.revenueKpi.weekEndDate || "n/a"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Leads {snapshot.operations.revenueKpi.leadsSourced} • Close {snapshot.operations.revenueKpi.closeRatePct.toFixed(1)}% • Deposits{" "}
                    {snapshot.operations.revenueKpi.depositsCollected}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Decisions: scale {snapshot.operations.revenueKpi.decisionSummary.scale} / fix{" "}
                    {snapshot.operations.revenueKpi.decisionSummary.fix} / kill {snapshot.operations.revenueKpi.decisionSummary.kill}
                  </p>
                  <p className="text-xs text-zinc-500">
                    KPI snapshot: {formatTimestamp(snapshot.operations.revenueKpi.generatedAt)}
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="border-zinc-800 bg-zinc-950/90 lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-300" />
                    Agent Runtime Matrix
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {snapshot.agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="rounded-lg border border-zinc-800 bg-black/40 p-3 grid gap-3 md:grid-cols-[1fr_auto_auto]"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-zinc-100">{agent.label}</p>
                          <Badge className={RUNTIME_BADGE[agent.state]}>{agent.state}</Badge>
                        </div>
                        <p className="text-xs text-zinc-400">
                          {agent.role}
                          {agent.businessId ? ` • ${agent.businessId}` : ""}
                        </p>
                        <p className="text-xs text-zinc-500">Last seen: {formatTimestamp(agent.lastSeenAt)}</p>
                        {agent.channels.length > 0 && (
                          <p className="text-xs text-zinc-500">Channels: {agent.channels.join(", ")}</p>
                        )}
                        {agent.blockedBy.length > 0 && (
                          <p className="text-xs text-amber-300">Blocked by: {agent.blockedBy.join(", ")}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-zinc-700 bg-black/30 text-zinc-100 hover:bg-zinc-800"
                            disabled={Boolean(agentActionState[`${agent.id}:ping`])}
                            onClick={() => void runAgentAction(agent, "ping")}
                          >
                            Ping
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-zinc-700 bg-black/30 text-zinc-100 hover:bg-zinc-800"
                            disabled={Boolean(agentActionState[`${agent.id}:pause`])}
                            onClick={() => void runAgentAction(agent, "pause")}
                          >
                            Pause
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-zinc-700 bg-black/30 text-zinc-100 hover:bg-zinc-800"
                            disabled={Boolean(agentActionState[`${agent.id}:route`])}
                            onClick={() => void runAgentAction(agent, "route")}
                          >
                            Route
                          </Button>
                        </div>
                      </div>
                      <div className="text-right md:text-left">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Monthly Cost</p>
                        <p className="text-lg font-semibold text-cyan-200">${agent.estimatedMonthlyCostUsd.toFixed(2)}</p>
                      </div>
                      <div className="text-right md:text-left">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Agent ID</p>
                        <p className="text-sm text-zinc-300">{agent.id}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Throughput Quotas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Daily Runs</span>
                      <span>
                        {snapshot.quota.runsUsed}/{snapshot.quota.maxRunsPerDay}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400/80"
                        style={{ width: `${quotaPct(snapshot.quota.runsUsed, snapshot.quota.maxRunsPerDay)}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Daily Leads</span>
                      <span>
                        {snapshot.quota.leadsUsed}/{snapshot.quota.maxLeadsPerDay}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-fuchsia-400/80"
                        style={{ width: `${quotaPct(snapshot.quota.leadsUsed, snapshot.quota.maxLeadsPerDay)}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Concurrent Runs</span>
                      <span>
                        {snapshot.quota.activeRuns}/{snapshot.quota.maxActiveRuns}
                      </span>
                    </div>
                    <div className="h-2 rounded bg-zinc-900 overflow-hidden">
                      <div
                        className="h-full bg-emerald-400/80"
                        style={{ width: `${quotaPct(snapshot.quota.activeRuns, snapshot.quota.maxActiveRuns)}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-400">
                    Org ID: <span className="text-zinc-200">{snapshot.quota.orgId}</span>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Services + Tools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {snapshot.services.map((service) => (
                    <div key={service.id} className="rounded-md border border-zinc-800 bg-black/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{service.label}</p>
                          <p className="text-xs text-zinc-400">{service.detail}</p>
                        </div>
                        <div className="text-right space-y-1">
                          <Badge className={HEALTH_BADGE[service.state]}>{service.state}</Badge>
                          <p className="text-xs text-zinc-500">
                            {service.monthlyCostUsd > 0 ? `$${service.monthlyCostUsd.toFixed(2)}/mo` : "$0/mo"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Skills + Policies</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {snapshot.skills.map((skill) => (
                    <div key={skill.id} className="rounded-md border border-zinc-800 bg-black/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{skill.label}</p>
                          <p className="text-xs text-zinc-400">{skill.detail}</p>
                        </div>
                        <Badge className={HEALTH_BADGE[skill.state]}>{skill.state}</Badge>
                      </div>
                    </div>
                  ))}

                  <div className="mt-3 rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-400">
                    Cost model: <span className="text-zinc-200">{snapshot.costModel.method}</span>
                    <div className="mt-2 space-y-1">
                      <p>Agent estimate: ${snapshot.costModel.agentCostUsd.toFixed(2)}</p>
                      <p>Service estimate: ${snapshot.costModel.serviceCostUsd.toFixed(2)}</p>
                      <p>Live provider pulled: ${snapshot.costModel.liveProviderCostUsd.toFixed(2)}</p>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(snapshot.costModel.providerBilling || []).map((provider) => (
                        <div
                          key={provider.providerId}
                          className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-zinc-200">{provider.label}</p>
                            <Badge className={BILLING_BADGE[provider.status]}>{provider.status}</Badge>
                          </div>
                          <p className="mt-1 text-zinc-400">{provider.detail}</p>
                          <p className="mt-1 text-zinc-500">
                            {provider.monthlyCostUsd === null
                              ? "No live cost pulled"
                              : `$${provider.monthlyCostUsd.toFixed(2)} ${provider.currency || "USD"}`}{" "}
                            • {provider.source}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="border-zinc-800 bg-zinc-950/90 lg:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Recommendations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {snapshot.diagnostics.recommendations.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-md border border-zinc-800 bg-black/40 p-3 text-sm text-zinc-200">
                      {item}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90 lg:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Live Activity Feed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2 pb-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 px-2 text-xs ${
                        timelineFilter === "all"
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-300"
                      }`}
                      onClick={() => setTimelineFilter("all")}
                    >
                      All {liveFeedCounts.all}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 px-2 text-xs ${
                        timelineFilter === "tasks"
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-300"
                      }`}
                      onClick={() => setTimelineFilter("tasks")}
                    >
                      Tasks {liveFeedCounts.tasks}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 px-2 text-xs ${
                        timelineFilter === "comments"
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-300"
                      }`}
                      onClick={() => setTimelineFilter("comments")}
                    >
                      Comments {liveFeedCounts.comments}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 px-2 text-xs ${
                        timelineFilter === "status"
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-300"
                      }`}
                      onClick={() => setTimelineFilter("status")}
                    >
                      Status {liveFeedCounts.status}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 px-2 text-xs ${
                        timelineFilter === "decisions"
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900/80 text-zinc-300"
                      }`}
                      onClick={() => setTimelineFilter("decisions")}
                    >
                      Decisions {liveFeedCounts.decisions}
                    </Button>
                  </div>

                  {filteredLiveFeed.length === 0 ? (
                    <p className="text-sm text-zinc-500">No recent activity yet.</p>
                  ) : (
                    filteredLiveFeed.map((item) => (
                      <div key={item.id} className="rounded-md border border-zinc-800 bg-black/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-zinc-100 truncate">{item.title}</p>
                          <Badge
                            className={
                              item.kind === "heartbeat"
                                ? RUNTIME_BADGE.active
                                : item.kind === "alert"
                                  ? HEALTH_BADGE.degraded
                                  : item.kind === "decision"
                                    ? "border-violet-400/40 bg-violet-400/10 text-violet-200"
                                  : HEALTH_BADGE.offline
                            }
                          >
                            {item.timeline}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">{item.detail}</p>
                        <p className="mt-1 text-xs text-zinc-500">{formatTimestamp(item.ts ? new Date(item.ts).toISOString() : null)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-950/90 lg:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Top Bug Groups</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {snapshot.diagnostics.bugs.length === 0 ? (
                    <p className="text-sm text-zinc-500">No telemetry bug groups.</p>
                  ) : (
                    snapshot.diagnostics.bugs.map((bug) => (
                      <div key={bug.fingerprint} className="rounded-md border border-zinc-800 bg-black/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-zinc-100 truncate">{bug.message || bug.route || bug.fingerprint}</p>
                          <Badge className={HEALTH_BADGE.degraded}>{bug.count}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">{bug.route || "unknown route"} • {bug.triageStatus}</p>
                        <p className="mt-1 text-xs text-zinc-500">{formatTimestamp(bug.lastSeenAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
