"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface LeadRunDiagnostics {
  runId?: string | null;
  dryRun?: boolean;
  candidateTotal?: number | null;
  scoredCount?: number | null;
  filteredOut?: number | null;
  processed?: number;
  meetingsScheduled?: number;
  meetingsDrafted?: number;
  noSlot?: number;
  emailsSent?: number;
  emailsDrafted?: number;
  noEmail?: number;
}

function num(value: number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

export function RunDiagnostics({ diagnostics }: { diagnostics: LeadRunDiagnostics }) {
  const processed = num(diagnostics.processed);
  const scheduled = num(diagnostics.meetingsScheduled);
  const drafted = num(diagnostics.meetingsDrafted);
  const noSlot = num(diagnostics.noSlot);
  const emailsSent = num(diagnostics.emailsSent);
  const emailsDrafted = num(diagnostics.emailsDrafted);
  const noEmail = num(diagnostics.noEmail);

  return (
    <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Run Diagnostics</h3>
            <p className="text-sm text-zinc-400">What happened in this run</p>
          </div>
          <div className="flex items-center gap-2">
            {diagnostics.dryRun && (
              <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-200 border border-yellow-500/20">
                Dry Run
              </Badge>
            )}
            {diagnostics.runId && (
              <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                Run {diagnostics.runId.slice(0, 8)}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Candidates</div>
            <div className="text-lg font-semibold text-white">{diagnostics.candidateTotal ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Scored In</div>
            <div className="text-lg font-semibold text-white">{diagnostics.scoredCount ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Filtered Out</div>
            <div className="text-lg font-semibold text-white">{diagnostics.filteredOut ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Processed</div>
            <div className="text-lg font-semibold text-white">{processed}</div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Meetings Scheduled</div>
            <div className="text-lg font-semibold text-white">{scheduled}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Meetings Drafted</div>
            <div className="text-lg font-semibold text-white">{drafted}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">No Slot</div>
            <div className="text-lg font-semibold text-white">{noSlot}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">No Email</div>
            <div className="text-lg font-semibold text-white">{noEmail}</div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Emails Sent</div>
            <div className="text-lg font-semibold text-white">{emailsSent}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
            <div className="text-xs text-zinc-500">Emails Drafted</div>
            <div className="text-lg font-semibold text-white">{emailsDrafted}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

