"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface LeadRunDiagnostics {
  runId?: string | null;
  dryRun?: boolean;
  candidateTotal?: number | null;
  scoredCount?: number | null;
  filteredOut?: number | null;
  sourceWithEmail?: number | null;
  sourceWithoutEmail?: number | null;
  processed?: number;
  failedLeads?: number;
  queueLagSeconds?: number | null;
  calendarRetries?: number;
  meetingsScheduled?: number;
  meetingsDrafted?: number;
  noSlot?: number;
  emailsSent?: number;
  emailsDrafted?: number;
  noEmail?: number;
  smsSent?: number;
  callsPlaced?: number;
  avatarsQueued?: number;
  channelFailures?: number;
}

function num(value: number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

export function RunDiagnostics({ diagnostics }: { diagnostics: LeadRunDiagnostics }) {
  const processed = num(diagnostics.processed);
  const failedLeads = num(diagnostics.failedLeads);
  const queueLagSeconds = num(diagnostics.queueLagSeconds);
  const calendarRetries = num(diagnostics.calendarRetries);
  const sourceWithEmail = num(diagnostics.sourceWithEmail);
  const sourceWithoutEmail = num(diagnostics.sourceWithoutEmail);
  const scheduled = num(diagnostics.meetingsScheduled);
  const drafted = num(diagnostics.meetingsDrafted);
  const noSlot = num(diagnostics.noSlot);
  const emailsSent = num(diagnostics.emailsSent);
  const emailsDrafted = num(diagnostics.emailsDrafted);
  const noEmail = num(diagnostics.noEmail);
  const smsSent = num(diagnostics.smsSent);
  const callsPlaced = num(diagnostics.callsPlaced);
  const avatarsQueued = num(diagnostics.avatarsQueued);
  const channelFailures = num(diagnostics.channelFailures);

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
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Candidates</div>
            <div className="text-lg font-semibold text-white">{diagnostics.candidateTotal ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Scored In</div>
            <div className="text-lg font-semibold text-white">{diagnostics.scoredCount ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Filtered Out</div>
            <div className="text-lg font-semibold text-white">{diagnostics.filteredOut ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Processed</div>
            <div className="text-lg font-semibold text-white">{processed}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">With Email</div>
            <div className="text-lg font-semibold text-white">{sourceWithEmail}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Without Email</div>
            <div className="text-lg font-semibold text-white">{sourceWithoutEmail}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">Queue Lag (sec)</div>
            <div className="text-lg font-semibold text-white">{queueLagSeconds}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-orange-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Calendar Retries</div>
            <div className="text-lg font-semibold text-white">{calendarRetries}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-red-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Worker Failed Leads</div>
            <div className="text-lg font-semibold text-white">{failedLeads}</div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-emerald-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Meetings Scheduled</div>
            <div className="text-lg font-semibold text-white">{scheduled}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-cyan-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Meetings Drafted</div>
            <div className="text-lg font-semibold text-white">{drafted}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-amber-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">No Slot</div>
            <div className="text-lg font-semibold text-white">{noSlot}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900/60 to-zinc-900/20 p-3">
            <div className="text-xs text-zinc-500">No Email</div>
            <div className="text-lg font-semibold text-white">{noEmail}</div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-emerald-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Emails Sent</div>
            <div className="text-lg font-semibold text-white">{emailsSent}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-cyan-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Emails Drafted</div>
            <div className="text-lg font-semibold text-white">{emailsDrafted}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-indigo-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">SMS Sent</div>
            <div className="text-lg font-semibold text-white">{smsSent}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-blue-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Calls Placed</div>
            <div className="text-lg font-semibold text-white">{callsPlaced}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-violet-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Avatars Queued</div>
            <div className="text-lg font-semibold text-white">{avatarsQueued}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-red-900/20 to-zinc-900/10 p-3">
            <div className="text-xs text-zinc-500">Channel Failures</div>
            <div className="text-lg font-semibold text-white">{channelFailures}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
