"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAuthHeaders,
  getResponseCorrelationId,
  readApiJson,
} from "@/lib/api/client";
import type {
  RepoImprovementDecision,
  RepoImprovementReviewResponse,
  RepoImprovementSnapshot,
} from "@/lib/repo-improvement-contract";

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatRate(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None recorded";
}

function isReviewDecision(value: string): value is RepoImprovementDecision {
  return (
    value === "approve" ||
    value === "reject" ||
    value === "defer" ||
    value === "needs-human"
  );
}

export function RepoImprovementInbox() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<RepoImprovementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionById, setDecisionById] = useState<Record<string, RepoImprovementDecision | "">>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<Record<string, boolean>>({});

  const loadSnapshot = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!user) return;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError(null);

      try {
        const headers = await buildAuthHeaders(user);
        const response = await fetch("/api/agents/repo-improvement", {
          method: "GET",
          headers,
        });
        const payload = await readApiJson<
          RepoImprovementSnapshot & { error?: string }
        >(response);
        if (!response.ok) {
          const cid = getResponseCorrelationId(response);
          throw new Error(
            payload?.error ||
              `Repo-improvement request failed (${response.status}${
                cid ? ` cid=${cid}` : ""
              })`
          );
        }
        setSnapshot(payload);
      } catch (fetchError: unknown) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load repo-improvement inbox"
        );
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void loadSnapshot("initial");
  }, [user, loadSnapshot]);

  if (!user) {
    return null;
  }

  async function submitReview(reviewId: string) {
    if (!user || !snapshot) return;

    const decision = decisionById[reviewId];
    if (!decision) {
      setFeedbackById((prev) => ({
        ...prev,
        [reviewId]: "Select a decision before submitting.",
      }));
      return;
    }

    const reasonCode = (reasonById[reviewId] || "").trim();
    if (!reasonCode) {
      setFeedbackById((prev) => ({
        ...prev,
        [reviewId]: "Select a reason code before submitting.",
      }));
      return;
    }

    const idempotencyKey = `repo-improvement:${reviewId}:${decision}:${crypto.randomUUID()}`;
    setSubmitState((prev) => ({ ...prev, [reviewId]: true }));
    setFeedbackById((prev) => ({ ...prev, [reviewId]: "" }));

    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey });
      const response = await fetch("/api/agents/repo-improvement/review", {
        method: "POST",
        headers,
        body: JSON.stringify({
          reviewId,
          decision,
          reasonCode,
          notes: notesById[reviewId] || "",
          idempotencyKey,
        }),
      });
      const payload = await readApiJson<
        RepoImprovementReviewResponse & { error?: string; replayed?: boolean }
      >(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(
          payload?.error ||
            `Review submission failed (${response.status}${cid ? ` cid=${cid}` : ""})`
        );
      }

      setDecisionById((prev) => ({ ...prev, [reviewId]: "" }));
      setReasonById((prev) => ({ ...prev, [reviewId]: "" }));
      setNotesById((prev) => ({ ...prev, [reviewId]: "" }));
      setFeedbackById((prev) => ({
        ...prev,
        [reviewId]: `Recorded ${decision}${payload.replayed ? " (replayed)" : ""}.`,
      }));
      await loadSnapshot("refresh");
    } catch (submitError: unknown) {
      setFeedbackById((prev) => ({
        ...prev,
        [reviewId]:
          submitError instanceof Error
            ? submitError.message
            : "Failed to record review decision",
      }));
    } finally {
      setSubmitState((prev) => ({ ...prev, [reviewId]: false }));
    }
  }

  return (
    <Card className="border-cyan-500/20 bg-zinc-950/90">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Workflow className="h-4 w-4 text-cyan-300" />
              Overnight Improvement Inbox
            </CardTitle>
            <p className="text-sm text-zinc-400">
              Review the shared `repo-improvement` overnight proposals and bounded
              fixes from CodexSkills without leaving Agent Nexus.
            </p>
            {snapshot ? (
              <p className="text-xs text-zinc-500">
                Generated {formatTimestamp(snapshot.generatedAt)} • {snapshot.status}
              </p>
            ) : null}
          </div>
          <Button
            onClick={() => void loadSnapshot("refresh")}
            variant="outline"
            className="border-cyan-400/40 bg-black/30 text-cyan-100 hover:bg-cyan-400/10"
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh Inbox
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
          </div>
        ) : (
          <>
            {error ? (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}

            {snapshot ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Pending Review
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {snapshot.reviewSchema?.summary.pending_review_count ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Morning Approval
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatRate(snapshot.metrics?.rates.morning_approval_rate)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Verifier Pass
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatRate(snapshot.metrics?.rates.verifier_pass_rate)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Repeat Failure
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatRate(snapshot.metrics?.rates.repeat_failure_rate)}
                    </p>
                  </div>
                </div>

                <div
                  className={`rounded-lg px-4 py-3 text-sm ${
                    snapshot.status === "available"
                      ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                      : snapshot.status === "degraded"
                        ? "border border-amber-400/30 bg-amber-500/10 text-amber-100"
                        : "border border-zinc-700 bg-zinc-900/80 text-zinc-200"
                  }`}
                >
                  {snapshot.detail}
                  <div className="mt-2 space-y-1 text-xs text-zinc-300">
                    <p>Report root: {snapshot.paths.reportRoot}</p>
                    <p>Review script: {snapshot.paths.reviewScriptPath}</p>
                  </div>
                </div>

                {snapshot.reviewSchema?.inbox_items.length ? (
                  <div className="space-y-4">
                    {snapshot.reviewSchema.inbox_items.map((item) => {
                      const decision = decisionById[item.review_id] || "";
                      const reasonOptions = decision
                        ? snapshot.reviewSchema?.schema.reason_codes.filter((reason) =>
                            reason.decisions.includes(decision)
                          ) || []
                        : [];
                      const selectedReason = reasonOptions.find(
                        (reason) => reason.id === reasonById[item.review_id]
                      );

                      return (
                        <div
                          key={item.review_id}
                          className="rounded-xl border border-zinc-800 bg-black/40 p-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-zinc-100">
                                  {item.repo}
                                </p>
                                <Badge className="border-violet-400/40 bg-violet-400/10 text-violet-200">
                                  {item.overnight_decision}
                                </Badge>
                                {item.proposal_patch_class ? (
                                  <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
                                    {item.proposal_patch_class}
                                  </Badge>
                                ) : null}
                                {item.proposal_ready ? (
                                  <Badge className="border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
                                    proposal-ready
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm text-zinc-300">
                                {item.proposal_summary || "No dry-run proposal summary recorded."}
                              </p>
                              <div className="space-y-1 text-xs text-zinc-500">
                                <p>Review ID: {item.review_id}</p>
                                <p>Run ID: {item.run_id}</p>
                                <p>Generated: {formatTimestamp(item.generated_at)}</p>
                                <p>Score: {item.score}</p>
                                <p>
                                  Verifiers: {item.verifier_passed_count}/
                                  {item.verifier_total_count}
                                </p>
                                <p>Fix classes: {formatList(item.fix_classes)}</p>
                                <p>Files touched: {formatList(item.files_touched)}</p>
                                {item.failure_signature ? (
                                  <p>Failure signature: {item.failure_signature}</p>
                                ) : null}
                                {item.proposal_path ? (
                                  <p>Proposal artifact: {item.proposal_path}</p>
                                ) : null}
                              </div>
                            </div>

                            <div className="grid w-full gap-3 md:max-w-xl md:grid-cols-2">
                              <div className="space-y-2">
                                <p className="text-xs uppercase tracking-wide text-zinc-500">
                                  Decision
                                </p>
                                <Select
                                  value={decision || undefined}
                                  onValueChange={(value) => {
                                    if (!isReviewDecision(value)) return;
                                    setDecisionById((prev) => ({
                                      ...prev,
                                      [item.review_id]: value,
                                    }));
                                    setReasonById((prev) => {
                                      const current = prev[item.review_id] || "";
                                      const matchingReasons =
                                        snapshot.reviewSchema?.schema.reason_codes.filter(
                                          (reason) => reason.decisions.includes(value)
                                        ) || [];
                                      const keepCurrent = matchingReasons.some(
                                        (reason) => reason.id === current
                                      );
                                      return {
                                        ...prev,
                                        [item.review_id]: keepCurrent
                                          ? current
                                          : matchingReasons[0]?.id || "",
                                      };
                                    });
                                  }}
                                >
                                  <SelectTrigger className="border-zinc-700 bg-black/30 text-zinc-100">
                                    <SelectValue placeholder="Select decision" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {snapshot.reviewSchema?.schema.decision_labels.map((label) => (
                                      <SelectItem key={label.id} value={label.id}>
                                        {label.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <p className="text-xs uppercase tracking-wide text-zinc-500">
                                  Reason Code
                                </p>
                                <Select
                                  value={reasonById[item.review_id] || undefined}
                                  onValueChange={(value) =>
                                    setReasonById((prev) => ({
                                      ...prev,
                                      [item.review_id]: value,
                                    }))
                                  }
                                  disabled={!decision}
                                >
                                  <SelectTrigger className="border-zinc-700 bg-black/30 text-zinc-100">
                                    <SelectValue placeholder="Select reason" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {reasonOptions.map((reason) => (
                                      <SelectItem key={reason.id} value={reason.id}>
                                        {reason.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {selectedReason ? (
                                  <p className="text-xs text-zinc-500">
                                    {selectedReason.description}
                                  </p>
                                ) : null}
                              </div>

                              <div className="md:col-span-2 space-y-2">
                                <p className="text-xs uppercase tracking-wide text-zinc-500">
                                  Notes
                                </p>
                                <Textarea
                                  value={notesById[item.review_id] || ""}
                                  onChange={(event) =>
                                    setNotesById((prev) => ({
                                      ...prev,
                                      [item.review_id]: event.target.value,
                                    }))
                                  }
                                  className="min-h-[96px] border-zinc-700 bg-black/30 text-zinc-100 placeholder:text-zinc-500"
                                  placeholder="Optional operator notes for the review ledger"
                                />
                              </div>

                              <div className="md:col-span-2 flex flex-col gap-2">
                                {feedbackById[item.review_id] ? (
                                  <div className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                                    {feedbackById[item.review_id]}
                                  </div>
                                ) : null}
                                <Button
                                  onClick={() => void submitReview(item.review_id)}
                                  disabled={
                                    submitState[item.review_id] ||
                                    !snapshot.reviewScriptAvailable
                                  }
                                  className="justify-center bg-cyan-500 text-black hover:bg-cyan-400"
                                >
                                  {submitState[item.review_id] ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                  )}
                                  Record Review Decision
                                </Button>
                              </div>
                            </div>
                          </div>

                          {item.evidence_refs.length > 0 ? (
                            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
                                Evidence
                              </p>
                              <div className="space-y-1 text-xs text-zinc-400">
                                {item.evidence_refs.slice(0, 4).map((ref) => (
                                  <p key={ref}>{ref}</p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-6 text-sm text-zinc-400">
                    <div className="flex items-center gap-2 text-zinc-200">
                      {snapshot.status === "available" ? (
                        <Clock3 className="h-4 w-4 text-cyan-300" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-300" />
                      )}
                      No pending repo-improvement reviews right now.
                    </div>
                    <p className="mt-2">
                      Morning metrics stay available through{" "}
                      {snapshot.paths.metricsJsonPath}.
                    </p>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
