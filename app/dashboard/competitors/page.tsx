"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

type Competitor = { name: string; url: string };

type Monitor = {
  monitorId: string;
  name: string;
  competitors: Competitor[];
  frequencyHours: number;
  nextRunAtMs: number | null;
  lastRunAt: string | null;
  status: "idle" | "running" | "error";
  lastError: string | null;
};

type MonitorReport = {
  reportId: string;
  generatedAt: string | null;
  createdAt: string | null;
  competitorCount: number;
  summary: Record<string, unknown>;
};

function parseCompetitorLines(value: string): Competitor[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: Competitor[] = [];
  for (const line of lines) {
    const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      parsed.push({ name: parts[0], url: parts[0] });
      continue;
    }
    parsed.push({ name: parts[0], url: parts[1] });
  }
  return parsed;
}

function asIsoDisplay(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function CompetitorsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningMonitorId, setRunningMonitorId] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [reports, setReports] = useState<MonitorReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [name, setName] = useState("");
  const [frequencyHours, setFrequencyHours] = useState(24);
  const [competitorsText, setCompetitorsText] = useState(
    "Competitor One | https://example.com\nCompetitor Two | https://example.org"
  );

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.monitorId === selectedMonitorId) || null,
    [monitors, selectedMonitorId]
  );

  const fetchMonitors = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/competitors/monitor", { headers, cache: "no-store" });
      const payload = await readApiJson<{ monitors?: Monitor[]; error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to load monitors${cid ? ` cid=${cid}` : ""}`);
      }
      const list = payload.monitors || [];
      setMonitors(list);
      setSelectedMonitorId((current) => current || list[0]?.monitorId || null);
    } catch (error) {
      toast.error("Failed to load monitors", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchReports = useCallback(async () => {
    if (!user || !selectedMonitorId) {
      setReports([]);
      return;
    }
    setReportsLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch(
        `/api/competitors/monitor/${encodeURIComponent(selectedMonitorId)}/reports?limit=10`,
        { headers, cache: "no-store" }
      );
      const payload = await readApiJson<{ reports?: MonitorReport[]; error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to load reports${cid ? ` cid=${cid}` : ""}`);
      }
      setReports(payload.reports || []);
    } catch (error) {
      toast.error("Failed to load reports", {
        description: error instanceof Error ? error.message : String(error),
      });
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  }, [selectedMonitorId, user]);

  useEffect(() => {
    void fetchMonitors();
  }, [fetchMonitors]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  const handleCreateMonitor = async () => {
    if (!user) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Monitor name is required");
      return;
    }
    const competitors = parseCompetitorLines(competitorsText);
    if (competitors.length === 0) {
      toast.error("Add at least one competitor line");
      return;
    }

    setSaving(true);
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
      const response = await fetch("/api/competitors/monitor", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: trimmedName,
          competitors,
          frequencyHours: Math.max(1, Math.min(168, Math.round(frequencyHours))),
          runNow: true,
        }),
      });
      const payload = await readApiJson<{ monitor?: Monitor; error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to save monitor${cid ? ` cid=${cid}` : ""}`);
      }
      toast.success("Monitor saved");
      setName("");
      await fetchMonitors();
    } catch (error) {
      toast.error("Failed to save monitor", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (monitor: Monitor) => {
    if (!user) return;
    setRunningMonitorId(monitor.monitorId);
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
      const response = await fetch("/api/competitors/monitor", {
        method: "POST",
        headers,
        body: JSON.stringify({
          monitorId: monitor.monitorId,
          name: monitor.name,
          competitors: monitor.competitors,
          frequencyHours: monitor.frequencyHours,
          runNow: true,
        }),
      });
      const payload = await readApiJson<{ error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to trigger monitor${cid ? ` cid=${cid}` : ""}`);
      }
      toast.success("Monitor run queued");
      await fetchMonitors();
      await fetchReports();
    } catch (error) {
      toast.error("Failed to run monitor", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunningMonitorId(null);
    }
  };

  return (
    <div className="min-h-screen bg-black p-6 md:p-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="border-zinc-800 bg-zinc-950">
            <CardHeader>
              <CardTitle>Competitor Monitor</CardTitle>
              <CardDescription>
                Schedule recurring competitor website snapshots and track report history.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Monitor Name</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="border-zinc-700 bg-zinc-900"
                  placeholder="NOLA Art Galleries"
                />
              </div>
              <div className="space-y-2">
                <Label>Frequency (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={frequencyHours}
                  onChange={(event) => setFrequencyHours(Number(event.target.value || 24))}
                  className="border-zinc-700 bg-zinc-900"
                />
              </div>
              <div className="space-y-2">
                <Label>Competitors (Name | URL, one per line)</Label>
                <Textarea
                  value={competitorsText}
                  onChange={(event) => setCompetitorsText(event.target.value)}
                  className="min-h-40 border-zinc-700 bg-zinc-900"
                />
              </div>
              <Button
                className="w-full bg-zinc-100 text-black hover:bg-zinc-200"
                onClick={handleCreateMonitor}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save + Run Now
              </Button>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Monitors</CardTitle>
                <CardDescription>{monitors.length} configured</CardDescription>
              </div>
              <Button
                size="icon"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => void fetchMonitors()}
                disabled={loading}
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                <div className="flex items-center text-sm text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading monitors...
                </div>
              ) : monitors.length === 0 ? (
                <p className="text-sm text-zinc-500">No competitor monitors yet.</p>
              ) : (
                monitors.map((monitor) => (
                  <button
                    key={monitor.monitorId}
                    className={`w-full rounded-md border p-3 text-left transition ${
                      selectedMonitorId === monitor.monitorId
                        ? "border-cyan-500/60 bg-cyan-500/10"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                    }`}
                    onClick={() => setSelectedMonitorId(monitor.monitorId)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{monitor.name}</p>
                      <Badge
                        variant="secondary"
                        className={
                          monitor.status === "error"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : monitor.status === "running"
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700"
                        }
                      >
                        {monitor.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {monitor.competitors.length} competitors · every {monitor.frequencyHours}h
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Next run: {monitor.nextRunAtMs ? asIsoDisplay(new Date(monitor.nextRunAtMs).toISOString()) : "—"}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{selectedMonitor?.name || "Reports"}</CardTitle>
              <CardDescription>
                {selectedMonitor
                  ? `Last run: ${asIsoDisplay(selectedMonitor.lastRunAt)}`
                  : "Select a monitor to inspect report history."}
              </CardDescription>
            </div>
            {selectedMonitor && (
              <Button
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                onClick={() => void handleRunNow(selectedMonitor)}
                disabled={runningMonitorId === selectedMonitor.monitorId}
              >
                {runningMonitorId === selectedMonitor.monitorId ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Run now
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedMonitor ? (
              <p className="text-sm text-zinc-500">No monitor selected.</p>
            ) : reportsLoading ? (
              <div className="flex items-center text-sm text-zinc-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading reports...
              </div>
            ) : reports.length === 0 ? (
              <p className="text-sm text-zinc-500">No reports yet. Trigger a run to generate one.</p>
            ) : (
              reports.map((report) => (
                <div key={report.reportId} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">
                      Report {report.reportId.slice(0, 8)}
                    </p>
                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 border-zinc-700">
                      {report.competitorCount} sites
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Generated: {asIsoDisplay(report.generatedAt)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Summary: emails={String(report.summary?.totalEmails ?? 0)} · phones=
                    {String(report.summary?.totalPhones ?? 0)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

