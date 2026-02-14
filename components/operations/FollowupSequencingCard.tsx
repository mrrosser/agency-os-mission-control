"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

type FollowupTask = {
  taskId: string;
  status: "pending" | "processing" | "completed" | "skipped" | "failed";
  dueAtMs: number;
  lastError?: string | null;
  lead?: {
    companyName?: string;
    founderName?: string;
    email?: string;
  };
};

function countByStatus(tasks: FollowupTask[]) {
  const counts = { pending: 0, processing: 0, completed: 0, skipped: 0, failed: 0 };
  for (const t of tasks) {
    if (t.status in counts) counts[t.status as keyof typeof counts] += 1;
  }
  return counts;
}

function formatDue(dueAtMs: number) {
  if (!dueAtMs) return "unknown";
  try {
    return new Date(dueAtMs).toLocaleString();
  } catch {
    return String(dueAtMs);
  }
}

export function FollowupSequencingCard(props: { runId?: string | null }) {
  const { user } = useAuth();
  const runId = (props.runId || "").trim();

  const [tasks, setTasks] = useState<FollowupTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [delayHours, setDelayHours] = useState("48");

  const counts = useMemo(() => countByStatus(tasks), [tasks]);
  const sortedTasks = useMemo(() => {
    return tasks.slice().sort((a, b) => (a.dueAtMs || 0) - (b.dueAtMs || 0));
  }, [tasks]);

  const refresh = async () => {
    if (!user || !runId) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user, { correlationId: runId });
      const res = await fetch(`/api/outreach/followups?runId=${encodeURIComponent(runId)}`, {
        method: "GET",
        headers,
      });
      const json = await readApiJson<{ tasks?: FollowupTask[]; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(json?.error || `Failed to load follow-ups (status ${res.status}${cid ? ` cid=${cid}` : ""})`);
      }
      setTasks(Array.isArray(json.tasks) ? json.tasks : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not load follow-up tasks", { description: message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, runId]);

  const queue = async () => {
    if (!user || !runId) return;
    setQueueing(true);
    try {
      const headers = await buildAuthHeaders(user, {
        correlationId: runId,
        idempotencyKey: crypto.randomUUID(),
      });

      const res = await fetch("/api/outreach/followups", {
        method: "POST",
        headers,
        body: JSON.stringify({
          runId,
          delayHours: Number.parseInt(delayHours, 10),
          maxLeads: 25,
          sequence: 1,
        }),
      });

      const json = await readApiJson<{ created?: number; existing?: number; skippedNoEmail?: number; skippedNoOutreach?: number; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(json?.error || `Queue failed (status ${res.status}${cid ? ` cid=${cid}` : ""})`);
      }

      toast.success("Follow-up drafts queued", {
        description: `Created ${json.created || 0}. Existing ${json.existing || 0}. Skipped ${json.skippedNoEmail || 0} missing email.`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not queue follow-ups", { description: message });
    } finally {
      setQueueing(false);
    }
  };

  const runWorker = async () => {
    if (!user || !runId) return;
    setProcessing(true);
    try {
      const headers = await buildAuthHeaders(user, {
        correlationId: runId,
        idempotencyKey: crypto.randomUUID(),
      });

      const res = await fetch("/api/outreach/followups/worker", {
        method: "POST",
        headers,
        body: JSON.stringify({
          runId,
          maxTasks: 5,
          dryRun: false,
        }),
      });

      const json = await readApiJson<{ processed?: number; completed?: number; skipped?: number; failed?: number; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(json?.error || `Worker failed (status ${res.status}${cid ? ` cid=${cid}` : ""})`);
      }

      toast.success("Follow-up worker completed", {
        description: `Processed ${json.processed || 0}; drafted ${json.completed || 0}; skipped ${json.skipped || 0}; failed ${json.failed || 0}.`,
      });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not process follow-ups", { description: message });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Follow-up Sequencing</h3>
            <p className="text-xs text-zinc-400">Draft-first follow-ups (no sends)</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={!user || !runId || loading}
            className="h-9 w-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
            aria-label="Refresh follow-ups"
          >
            <RefreshCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>

        {!runId ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-500">
            Load or start a run to queue follow-up drafts.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-300">
                pending {counts.pending}
              </Badge>
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-300">
                processing {counts.processing}
              </Badge>
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-300">
                completed {counts.completed}
              </Badge>
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-300">
                skipped {counts.skipped}
              </Badge>
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-300">
                failed {counts.failed}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-200">Delay</p>
                <Select value={delayHours} onValueChange={setDelayHours}>
                  <SelectTrigger className="h-10 bg-zinc-900 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                    <SelectItem value="72">72 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  onClick={queue}
                  disabled={!user || !runId || queueing}
                  className="h-10 bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Queue drafts"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runWorker}
                  disabled={!user || !runId || processing}
                  className="h-10 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                >
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Process due"}
                </Button>
              </div>
            </div>

            {sortedTasks.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
                <p className="text-zinc-400">Next up</p>
                {sortedTasks.slice(0, 3).map((t) => (
                  <div key={t.taskId} className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-zinc-200">
                        {t.lead?.companyName || "Lead"}{" "}
                        <span className="text-zinc-500">({t.lead?.email || "no email"})</span>
                      </p>
                      <p className="text-zinc-500">due {formatDue(t.dueAtMs)}</p>
                      {t.status === "failed" && t.lastError ? (
                        <p className="text-red-300">error: {t.lastError}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

