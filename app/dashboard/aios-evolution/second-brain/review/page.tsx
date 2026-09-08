"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BrainCircuit, CheckCircle2, Clock3, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import type { SecondBrainCandidate, SecondBrainDecision } from "@/lib/second-brain-contract";

type ActionInspection = {
  candidate: SecondBrainCandidate;
  decision: SecondBrainDecision;
  expiresAt: string;
  correlationId: string;
};

export default function SecondBrainEmailReviewPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [inspection, setInspection] = useState<ActionInspection | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "complete" | "error">("loading");
  const [message, setMessage] = useState("");

  const inspect = useCallback(async () => {
    if (!user || token.length < 32) return;
    setState("loading");
    try {
      const response = await fetch(`/api/agents/second-brain/email-action/inspect?token=${encodeURIComponent(token)}`, {
        headers: await buildAuthHeaders(user),
        cache: "no-store",
      });
      const payload = await readApiJson<ActionInspection & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `Action inspection failed (${response.status})`);
      setInspection(payload);
      setReasonCode(payload.decision === "approve" ? "verified-improvement" : payload.decision === "reject" ? "insufficient-evidence" : "awaiting-more-evidence");
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email action is unavailable");
      setState("error");
    }
  }, [token, user]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const confirm = async () => {
    if (!user || !inspection) return;
    setState("submitting");
    try {
      const idempotencyKey = `second-brain-email:${inspection.candidate.candidateId}:${inspection.decision}:${token.slice(-12)}`;
      const response = await fetch("/api/agents/second-brain/email-action/confirm", {
        method: "POST",
        headers: await buildAuthHeaders(user, { idempotencyKey }),
        body: JSON.stringify({ token, reasonCode, notes: notes || undefined, idempotencyKey }),
      });
      const payload = await readApiJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `Confirmation failed (${response.status})`);
      setState("complete");
      setMessage(`${inspection.decision} recorded. Mission Control is now the authoritative review record.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Confirmation failed");
      setState("error");
    }
  };

  const decisionColor = inspection?.decision === "approve" ? "text-emerald-200" : inspection?.decision === "reject" ? "text-rose-200" : "text-amber-200";

  return (
    <main className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute h-[34rem] w-[34rem] rounded-full bg-cyan-300/10 blur-[130px]" />
      <section className="relative w-full overflow-hidden rounded-2xl border border-cyan-200/15 bg-[#071216]/95 p-6 shadow-[0_40px_120px_rgba(0,0,0,.5)] sm:p-10">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
        <Link href="/dashboard/aios-evolution/second-brain" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-cyan-100"><ArrowLeft className="h-4 w-4" /> Memory Observatory</Link>

        {state === "loading" ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center text-zinc-300"><Loader2 className="h-8 w-8 animate-spin text-cyan-200" /><p className="mt-4">Verifying recipient, expiry, and candidate hash…</p></div>
        ) : null}

        {state === "error" ? (
          <div className="mt-10 rounded-xl border border-rose-300/25 bg-rose-300/10 p-6 text-rose-100">
            <AlertTriangle className="h-7 w-7" />
            <h1 className="mt-4 text-2xl font-semibold">This email action cannot be used</h1>
            <p className="mt-3 text-rose-100/80">{message}</p>
            <Button onClick={() => void inspect()} className="mt-5 bg-rose-100 text-rose-950 hover:bg-white">Check again</Button>
          </div>
        ) : null}

        {state === "complete" ? (
          <div className="mt-10 rounded-xl border border-emerald-300/25 bg-emerald-300/10 p-7 text-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-200" />
            <h1 className="mt-4 text-3xl font-semibold">Decision recorded</h1>
            <p className="mt-3 text-emerald-50/75">{message}</p>
            <Button asChild className="mt-6 bg-emerald-200 text-emerald-950 hover:bg-emerald-100"><Link href="/dashboard/aios-evolution/second-brain">Return to Memory Observatory</Link></Button>
          </div>
        ) : null}

        {(state === "ready" || state === "submitting") && inspection ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.25fr_.75fr]">
            <div>
              <div className="flex items-center gap-2 text-cyan-200"><BrainCircuit className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[.18em]">Email-initiated review</span></div>
              <h1 className="mt-4 text-3xl font-semibold text-white sm:text-5xl">Confirm <span className={decisionColor}>{inspection.decision}</span></h1>
              <p className="mt-5 text-lg leading-8 text-zinc-300">{inspection.candidate.purpose}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge className="border-cyan-200/20 bg-cyan-200/10 text-cyan-100">{inspection.candidate.skillName}</Badge>
                <Badge className="border-white/10 bg-white/5 text-zinc-200">{inspection.candidate.caseCount} cases</Badge>
                <Badge className="border-white/10 bg-white/5 text-zinc-200">{inspection.candidate.evidenceCount} traces</Badge>
              </div>
              <div className="mt-6 rounded-xl border border-white/10 bg-black/25 p-5">
                <p className="text-sm leading-6 text-zinc-400">{inspection.candidate.safeDiffSummary || "The full atomic candidate remains local; this page contains only its sanitized review summary."}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-white/[.04] p-3"><p className="text-xs uppercase text-zinc-500">Quality delta</p><p className="mt-1 text-xl font-semibold text-white">{inspection.candidate.qualityDeltaPoints >= 0 ? "+" : ""}{inspection.candidate.qualityDeltaPoints.toFixed(1)} pts</p></div>
                  <div className="rounded-lg bg-white/[.04] p-3"><p className="text-xs uppercase text-zinc-500">Efficiency</p><p className="mt-1 text-xl font-semibold text-white">{inspection.candidate.efficiencyImprovement >= 0 ? "+" : ""}{(inspection.candidate.efficiencyImprovement * 100).toFixed(1)}%</p></div>
                </div>
              </div>
            </div>

            <aside className="rounded-xl border border-white/10 bg-black/35 p-5">
              <div className="flex items-center gap-2 text-emerald-200"><ShieldCheck className="h-5 w-5" /><span className="text-sm font-semibold">Protected confirmation</span></div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">This single-use action is bound to your Firebase identity, the selected decision, and the exact candidate hash.</p>
              <label className="mt-6 block text-xs font-semibold uppercase tracking-[.12em] text-zinc-500" htmlFor="reason-code">Reason code</label>
              <input id="reason-code" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="mt-2 w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" />
              <label className="mt-4 block text-xs font-semibold uppercase tracking-[.12em] text-zinc-500" htmlFor="notes">Notes</label>
              <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/50" placeholder="Optional context for the evolution ledger" />
              <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><Clock3 className="h-4 w-4" /> Expires {new Date(inspection.expiresAt).toLocaleString()}</p>
              <Button onClick={() => void confirm()} disabled={state === "submitting" || !reasonCode.trim()} className="mt-6 w-full bg-cyan-200 text-cyan-950 hover:bg-cyan-100">
                {state === "submitting" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Confirm {inspection.decision}
              </Button>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
