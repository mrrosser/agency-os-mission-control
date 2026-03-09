"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { AlertCircle, Clock3, ExternalLink, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import type { EmailApprovalQueueItem } from "@/lib/lead-runs/approval-queue";

interface ApprovalQueueResponse {
  email?: EmailApprovalQueueItem[];
}

function statusBadgeClass(status: EmailApprovalQueueItem["status"]): string {
  if (status === "simulated") {
    return "bg-cyan-500/10 text-cyan-200 border-cyan-500/20";
  }
  if (status === "complete") {
    return "bg-emerald-500/10 text-emerald-200 border-emerald-500/20";
  }
  if (status === "skipped") {
    return "bg-zinc-700/40 text-zinc-200 border-zinc-600";
  }
  return "bg-red-500/10 text-red-200 border-red-500/20";
}

export default function InboxPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<EmailApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLastError(null);

    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/dashboard/approval-queue?emailLimit=24", {
        headers,
      });
      const payload = await readApiJson<ApprovalQueueResponse & { error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to load approval queue${cid ? ` cid=${cid}` : ""}`);
      }
      setItems(payload.email || []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Could not load draft approvals", {
        description: message,
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  return (
    <div className="min-h-screen bg-black p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                <AfroGlyph variant="inbox" className="h-6 w-6 text-cyan-300" />
              </div>
              <h1 className="text-3xl font-bold text-white">Inbox</h1>
            </div>
            <p className="text-zinc-400">
              Mission Control email queue. Only drafted outreach that needs operator review appears here.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void loadQueue()}
              disabled={loading}
              className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button asChild variant="outline" className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
              <Link href="/dashboard/operations">Open Operations</Link>
            </Button>
            <Button asChild className="bg-white text-black hover:bg-zinc-200">
              <Link href="/dashboard/integrations">Manage Connections</Link>
            </Button>
          </div>
        </div>

        <Card className="border-zinc-800 bg-zinc-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-white">Approval Queue</CardTitle>
            <CardDescription>
              Raw Gmail inbox threads are intentionally hidden here. Use this page for draft-first outreach review only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {lastError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{lastError}</span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <Badge variant="secondary" className="border-zinc-700 bg-zinc-900 text-zinc-200">
                {items.length} draft{items.length === 1 ? "" : "s"} awaiting review
              </Badge>
              <span>Draft IDs and run IDs stay attached for auditability.</span>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-32 animate-pulse rounded-xl bg-zinc-900/60" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 px-6 py-16 text-center">
                <AfroGlyph variant="inbox" className="mx-auto mb-4 h-14 w-14 text-zinc-700" />
                <p className="text-lg font-medium text-white">No draft approvals waiting right now</p>
                <p className="mt-2 text-sm text-zinc-500">
                  Run outreach with <span className="text-zinc-300">Draft First</span> enabled to route emails into this queue.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900/80 p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="border-cyan-500/20 bg-cyan-500/10 text-cyan-200">
                            {item.queueLabel}
                          </Badge>
                          <Badge variant="outline" className={statusBadgeClass(item.status)}>
                            {item.status === "simulated" ? "Simulated" : "Ready"}
                          </Badge>
                          <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                            Run {item.runId.slice(0, 8)}
                          </Badge>
                        </div>

                        <div>
                          <h2 className="text-xl font-semibold text-white">
                            {item.companyName}
                            {item.founderName ? (
                              <span className="ml-2 text-sm font-normal text-zinc-400">for {item.founderName}</span>
                            ) : null}
                          </h2>
                          <p className="mt-1 text-sm text-zinc-400">{item.subject || "Draft subject unavailable"}</p>
                        </div>

                        <div className="grid gap-2 text-sm text-zinc-400 md:grid-cols-2">
                          <div className="flex items-start gap-2">
                            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                            <div>
                              <p className="text-zinc-300">
                                {item.recipients.length > 0 ? item.recipients.join(", ") : item.leadEmail || "No recipient saved"}
                              </p>
                              <p className="text-xs text-zinc-500">Draft recipient</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                            <div>
                              <p className="text-zinc-300">
                                {item.updatedAt ? format(new Date(item.updatedAt), "MMM d, yyyy h:mm a") : "Unknown"}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {item.updatedAt ? `${formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}` : "No timestamp"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                          {item.draftId ? <span>Draft {item.draftId}</span> : null}
                          {item.threadId ? <span>Thread {item.threadId}</span> : null}
                          {item.messageId ? <span>Message {item.messageId}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 lg:min-w-48">
                        {item.website ? (
                          <Button asChild variant="outline" className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
                            <a href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noreferrer">
                              Website
                              <ExternalLink className="ml-2 h-4 w-4" />
                            </a>
                          </Button>
                        ) : null}
                        <Button asChild variant="outline" className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
                          <Link href="/dashboard/operations">Review in Operations</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
