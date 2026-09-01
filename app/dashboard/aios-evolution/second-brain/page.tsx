"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BrainCircuit,
  Check,
  Clock3,
  Database,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import type { SecondBrainDecision, SecondBrainSnapshot } from "@/lib/second-brain-contract";

function formatTime(value: string | null | undefined): string {
  if (!value) return "Not yet";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function statusTone(status: string): string {
  if (["approved", "promoted"].includes(status)) return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (["rejected", "reverted"].includes(status)) return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  if (status === "reviewable") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
}

function reasonForDecision(decision: SecondBrainDecision): string {
  if (decision === "approve") return "verified-improvement";
  if (decision === "reject") return "insufficient-evidence";
  if (decision === "defer") return "awaiting-more-evidence";
  return "manual-investigation";
}

export default function SecondBrainPage() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<SecondBrainSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agents/second-brain", {
        headers: await buildAuthHeaders(user),
        cache: "no-store",
      });
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(`Memory snapshot failed (${response.status}${cid ? ` · ${cid}` : ""})`);
      }
      setSnapshot(await readApiJson<SecondBrainSnapshot>(response));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load the second brain");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const submitDecision = useCallback(async (candidateId: string, candidateHash: string, decision: SecondBrainDecision) => {
    if (!user) return;
    const actionKey = `${candidateId}:${decision}`;
    setSubmitting(actionKey);
    try {
      const idempotencyKey = `second-brain:${candidateId}:${candidateHash}:${decision}`;
      const response = await fetch("/api/agents/second-brain/review", {
        method: "POST",
        headers: await buildAuthHeaders(user, { idempotencyKey }),
        body: JSON.stringify({
          candidateId,
          candidateHash,
          decision,
          reasonCode: reasonForDecision(decision),
          idempotencyKey,
        }),
      });
      if (!response.ok) {
        const payload: { error?: string } = await readApiJson<{ error?: string }>(response).catch(() => ({}));
        throw new Error(payload.error || `Review failed (${response.status})`);
      }
      toast.success(`${decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Deferred"} candidate`);
      await loadSnapshot();
    } catch (reviewError) {
      toast.error(reviewError instanceof Error ? reviewError.message : "Review failed");
    } finally {
      setSubmitting(null);
    }
  }, [loadSnapshot, user]);

  const pending = useMemo(
    () => snapshot?.candidates.filter((candidate) => candidate.status === "reviewable") || [],
    [snapshot]
  );
  const health = snapshot?.health;

  return (
    <main className="relative mx-auto min-h-screen max-w-[1500px] overflow-hidden px-4 py-6 sm:px-8 lg:px-10">
      <div className="pointer-events-none absolute left-[-12rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-cyan-300/10 blur-[110px]" />
      <div className="pointer-events-none absolute right-[-10rem] top-[10rem] h-[30rem] w-[30rem] rounded-full bg-amber-300/8 blur-[130px]" />

      <section className="relative overflow-hidden rounded-xl border border-cyan-200/15 bg-[#071216]/90 p-6 shadow-[0_35px_100px_rgba(0,0,0,0.38)] sm:p-8">
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(112,214,230,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(112,214,230,.08)_1px,transparent_1px)] [background-size:34px_34px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="relative flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-cyan-200">
              <BrainCircuit className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em]">Memory Observatory</span>
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              The portfolio remembers.
              <span className="block text-cyan-200/85">You decide what it learns.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300">
              Trace health, evidence-linked patterns, and evaluator-gated skill candidates—without exposing the encrypted raw vault.
            </p>
          </div>
          <Button
            onClick={() => void loadSnapshot()}
            disabled={loading}
            className="border border-cyan-200/20 bg-cyan-200/10 text-cyan-50 hover:bg-cyan-200/20"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh observatory
          </Button>
        </div>
      </section>

      {error ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-rose-300/25 bg-rose-300/10 p-4 text-rose-100">
          <AlertTriangle className="h-5 w-5" />
          {error}
        </div>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Registered sources", value: health?.sourceCount ?? "—", detail: `${health?.healthySourceCount ?? 0} healthy`, icon: Database },
          { label: "Encrypted traces", value: health?.traceCount ?? "—", detail: "90d hot · 365d archive", icon: Archive },
          { label: "Evidence-linked patterns", value: health?.patternCount ?? "—", detail: "Sanitized retrieval layer", icon: Sparkles },
          { label: "Awaiting judgment", value: pending.length, detail: `${health?.shadowCyclesPassed ?? 0}/7 shadow cycles`, icon: Clock3 },
        ].map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="group rounded-xl border border-white/10 bg-black/35 p-5 transition hover:-translate-y-0.5 hover:border-cyan-200/25">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
              <Icon className="h-5 w-5 text-cyan-200/80" />
            </div>
            <p className="mt-5 text-4xl font-semibold text-zinc-50">{value}</p>
            <p className="mt-2 text-sm text-zinc-400">{detail}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.55fr_.75fr]">
        <div className="rounded-xl border border-white/10 bg-[#080d10]/90">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Human promotion gate</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">Skill candidates</h2>
            </div>
            <Badge className="border-cyan-200/25 bg-cyan-200/10 text-cyan-100">{pending.length} pending</Badge>
          </div>

          <div className="divide-y divide-white/10">
            {snapshot?.candidates.map((candidate) => (
              <article key={candidate.candidateId} className="p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{candidate.skillName}</span>
                      <Badge className={statusTone(candidate.status)}>{candidate.status}</Badge>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold text-zinc-50">{candidate.purpose}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{candidate.safeDiffSummary || "Atomic candidate diff; raw trace content remains local."}</p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-300">
                      <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">Quality {candidate.qualityDeltaPoints >= 0 ? "+" : ""}{candidate.qualityDeltaPoints.toFixed(1)} pts</span>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">Efficiency {candidate.efficiencyImprovement >= 0 ? "+" : ""}{(candidate.efficiencyImprovement * 100).toFixed(1)}%</span>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">{candidate.caseCount} cases</span>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5">{candidate.evidenceCount} traces</span>
                    </div>
                    {candidate.riskFlags.length ? <p className="mt-3 text-sm text-amber-200">Risk signals: {candidate.riskFlags.join(", ")}</p> : null}
                  </div>

                  {candidate.status === "reviewable" ? (
                    <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[240px] lg:justify-end">
                      <Button
                        size="sm"
                        disabled={submitting !== null}
                        onClick={() => void submitDecision(candidate.candidateId, candidate.candidateHash, "approve")}
                        className="bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
                      >
                        <Check /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submitting !== null}
                        onClick={() => void submitDecision(candidate.candidateId, candidate.candidateHash, "defer")}
                        className="border-amber-300/30 bg-amber-300/5 text-amber-100 hover:bg-amber-300/15"
                      >
                        <Clock3 /> Defer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submitting !== null}
                        onClick={() => void submitDecision(candidate.candidateId, candidate.candidateHash, "reject")}
                        className="border-rose-300/30 bg-rose-300/5 text-rose-100 hover:bg-rose-300/15"
                      >
                        <X /> Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
            {!loading && !snapshot?.candidates.length ? (
              <div className="p-10 text-center text-zinc-400">
                <ShieldCheck className="mx-auto h-8 w-8 text-emerald-200" />
                <p className="mt-3">No skill candidates have reached the review gate.</p>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-white/10 bg-black/35 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-emerald-200/20 bg-emerald-200/10 p-2 text-emerald-200"><ShieldCheck className="h-5 w-5" /></div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Vault posture</p>
                <p className="font-semibold text-zinc-100">{health?.storageStatus || "Awaiting sync"}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Encryption key</dt><dd className={health?.keyReady ? "text-emerald-200" : "text-amber-200"}>{health?.keyReady ? "Ready" : "Not reported"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">QMD index</dt><dd className={health?.qmdReady ? "text-emerald-200" : "text-amber-200"}>{health?.qmdReady ? "Ready" : "Not reported"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Last capture</dt><dd className="text-right text-zinc-300">{formatTime(health?.lastCaptureAt)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">Last consolidation</dt><dd className="text-right text-zinc-300">{formatTime(health?.lastConsolidationAt)}</dd></div>
            </dl>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/35 p-5">
            <div className="flex items-center gap-2 text-cyan-100"><MailCheck className="h-5 w-5" /><h2 className="font-semibold">Email delivery</h2></div>
            <div className="mt-4 space-y-3">
              {snapshot?.notifications.slice(0, 6).map((notification) => (
                <div key={notification.notificationId} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium capitalize text-zinc-200">{notification.kind}</span>
                    <Badge className={notification.status === "delivered" ? "border-emerald-200/20 bg-emerald-200/10 text-emerald-100" : notification.status === "dead-letter" ? "border-rose-200/20 bg-rose-200/10 text-rose-100" : "border-amber-200/20 bg-amber-200/10 text-amber-100"}>{notification.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{formatTime(notification.createdAt)} · {notification.recipientCount} recipient(s)</p>
                </div>
              ))}
              {!snapshot?.notifications.length ? <p className="text-sm text-zinc-500">No delivery receipts yet.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-cyan-200/15 bg-cyan-200/[0.04] p-5">
            <div className="flex items-center gap-2 text-cyan-100"><Activity className="h-5 w-5" /><h2 className="font-semibold">Control-loop invariant</h2></div>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Workers receive bounded, frozen context. Maintainers can inspect traces. Only you can promote a reviewed skill.</p>
          </section>
        </aside>
      </section>
    </main>
  );
}
