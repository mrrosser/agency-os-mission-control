"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import type { LeadSourceRequest } from "@/lib/leads/types";
import {
  flattenRunAuditTimeline,
  pickAuditIds,
  type AuditLeadReceipt,
  type AuditActionStatus,
} from "@/lib/lead-runs/audit";

type RunMeta = {
  runId?: string;
  createdAt?: string;
  warnings?: string[];
  candidateTotal?: number;
  filteredOut?: number;
  total?: number;
  request?: LeadSourceRequest;
};

const STATUS_BADGE: Record<AuditActionStatus, string> = {
  complete: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-200",
  simulated: "bg-cyan-500/15 border border-cyan-500/30 text-cyan-200",
  skipped: "bg-zinc-700/40 border border-zinc-600 text-zinc-200",
  error: "bg-red-500/15 border border-red-500/30 text-red-200",
};

function externalLinks(data?: Record<string, unknown>): Array<{ label: string; href: string }> {
  if (!data) return [];
  const links: Array<{ label: string; href: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    if (!/^https?:\/\//i.test(value)) continue;
    links.push({ label: key, href: value });
  }
  return links;
}

function formatWhen(value?: string): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function formatRequest(request?: LeadSourceRequest): string {
  if (!request) return "n/a";
  const bits = [
    request.query ? `query="${request.query}"` : null,
    request.industry ? `industry="${request.industry}"` : null,
    request.location ? `location="${request.location}"` : null,
    typeof request.limit === "number" ? `limit=${request.limit}` : null,
    typeof request.minScore === "number" ? `minScore=${request.minScore}` : null,
    Array.isArray(request.sources) && request.sources.length > 0 ? `sources=${request.sources.join("+")}` : null,
    typeof request.includeEnrichment === "boolean" ? `enrich=${request.includeEnrichment}` : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(" • ") : "n/a";
}

export function RunAuditDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: RunMeta | null;
  leads: AuditLeadReceipt[];
  onSelectLead?: (leadDocId: string) => void;
}) {
  const timeline = useMemo(() => flattenRunAuditTimeline(props.leads || []), [props.leads]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { gmail: 0, calendar: 0, drive: 0, twilio: 0, other: 0 };
    for (const event of timeline) {
      const status = (event.status || "skipped") as AuditActionStatus;
      if (!(status === "complete" || status === "simulated")) continue;
      const prefix = String(event.actionId || "").split(".")[0] || "other";
      out[prefix] = (out[prefix] || 0) + 1;
    }
    return out;
  }, [timeline]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-white">Run Audit</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Verifies what actually got created/sent with timestamps + IDs.
          </DialogDescription>
        </DialogHeader>

        {!props.run ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
            Load a run to view audit details.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                  Run {props.run.runId?.slice(0, 8) || "n/a"}
                </Badge>
                <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                  created {formatWhen(props.run.createdAt)}
                </Badge>
                <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                  leads {typeof props.run.total === "number" ? props.run.total : props.leads.length}
                </Badge>
                {typeof props.run.candidateTotal === "number" && (
                  <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                    candidates {props.run.candidateTotal}
                  </Badge>
                )}
                {typeof props.run.filteredOut === "number" && (
                  <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                    filtered {props.run.filteredOut}
                  </Badge>
                )}
              </div>
              <div className="mt-2 text-xs text-zinc-500">Request: {formatRequest(props.run.request)}</div>
              {Array.isArray(props.run.warnings) && props.run.warnings.length > 0 && (
                <div className="mt-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                  {props.run.warnings.join(" ")}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge className="bg-zinc-900 text-zinc-400">gmail {counts.gmail || 0}</Badge>
                <Badge className="bg-zinc-900 text-zinc-400">calendar {counts.calendar || 0}</Badge>
                <Badge className="bg-zinc-900 text-zinc-400">drive {counts.drive || 0}</Badge>
                <Badge className="bg-zinc-900 text-zinc-400">twilio {counts.twilio || 0}</Badge>
              </div>
            </div>

            {timeline.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
                No receipts recorded yet for this run.
              </div>
            ) : (
              <div className="space-y-2">
                {timeline.map((event) => {
                  const status = (event.status || "skipped") as AuditActionStatus;
                  const links = externalLinks(event.data);
                  const ids = pickAuditIds(event.data).slice(0, 3);
                  return (
                    <div
                      key={`${event.leadDocId}-${event.actionId}-${event.updatedAt || "0"}`}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm text-zinc-200">{event.actionId}</p>
                          <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                          {event.replayed && <Badge className="bg-zinc-800 text-zinc-300">idempotent replay</Badge>}
                          {event.dryRun && <Badge className="bg-yellow-500/20 text-yellow-200">dry run</Badge>}
                        </div>
                        {props.onSelectLead && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                            onClick={() => props.onSelectLead?.(event.leadDocId)}
                          >
                            View lead
                          </Button>
                        )}
                      </div>

                      <div className="mt-2 text-xs text-zinc-500">
                        {event.companyName} {typeof event.score === "number" ? `• ICP ${event.score}` : ""} • updated{" "}
                        {formatWhen(event.updatedAt)}
                      </div>

                      {ids.length > 0 && (
                        <div className="mt-2 text-xs text-zinc-500">IDs: {ids.join(" • ")}</div>
                      )}

                      {links.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {links.slice(0, 3).map((link) => (
                            <Button
                              key={`${event.leadDocId}-${event.actionId}-${link.label}`}
                              asChild
                              size="sm"
                              variant="outline"
                              className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                            >
                              <a href={link.href} target="_blank" rel="noreferrer">
                                {link.label}
                                <ExternalLink className="ml-1 h-3 w-3" />
                              </a>
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

