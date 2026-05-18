"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Loader2,
  RefreshCw,
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
  GrowthResearchDecision,
  GrowthResearchReviewResponse,
  GrowthResearchSnapshot,
} from "@/lib/growth-research-contract";

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

function formatScore(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(1);
}

export function GrowthResearchInbox() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<GrowthResearchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionById, setDecisionById] = useState<
    Record<string, GrowthResearchDecision | "">
  >({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<Record<string, boolean>>({});
  const reviewSchema = snapshot?.reviewSchema ?? null;
  const reviewItems = reviewSchema?.inbox_items ?? [];
  const decisionLabels = reviewSchema?.schema.decision_labels ?? [];
  const reasonCodeOptions = reviewSchema?.schema.reason_codes ?? [];
  const governance = reviewSchema?.governance ?? snapshot?.metrics?.governance ?? null;
  const promotionReadyCount =
    reviewSchema?.summary.promotion_ready_count ??
    snapshot?.metrics?.promotion_candidates.filter(
      (candidate) => candidate.promotion_ready
    ).length ??
    0;
  const promotionCandidateCount =
    reviewSchema?.summary.promotion_candidate_count ??
    snapshot?.metrics?.promotion_candidates.length ??
    0;

  const loadSnapshot = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!user) return;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError(null);

      try {
        const headers = await buildAuthHeaders(user);
        const response = await fetch("/api/agents/growth-research", {
          method: "GET",
          headers,
        });
        const payload = await readApiJson<GrowthResearchSnapshot & { error?: string }>(
          response
        );
        if (!response.ok) {
          const cid = getResponseCorrelationId(response);
          throw new Error(
            payload?.error ||
              `Growth-research request failed (${response.status}${
                cid ? ` cid=${cid}` : ""
              })`
          );
        }
        setSnapshot(payload);
      } catch (fetchError: unknown) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load growth-research inbox"
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

    const idempotencyKey = `growth-research:${reviewId}:${decision}:${crypto.randomUUID()}`;
    setSubmitState((prev) => ({ ...prev, [reviewId]: true }));
    setFeedbackById((prev) => ({ ...prev, [reviewId]: "" }));

    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey });
      const response = await fetch("/api/agents/growth-research/review", {
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
        GrowthResearchReviewResponse & { error?: string; replayed?: boolean }
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
              <FlaskConical className="h-4 w-4 text-cyan-300" />
              Weekly Growth Research Inbox
            </CardTitle>
            <p className="text-sm text-zinc-400">
              Review the shared `growth-research` weekly recommendations and
              bounded draft scaffolds from CodexSkills without leaving Agent Nexus.
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
                <div className="grid gap-3 md:grid-cols-5">
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
                      Approval Rate
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatRate(snapshot.metrics?.rates.approval_rate)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      High Confidence
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatRate(snapshot.metrics?.rates.high_confidence_rate)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Avg Priority
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {formatScore(snapshot.metrics?.rates.average_priority_score)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Promotion Ready
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {promotionReadyCount}/{promotionCandidateCount}
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

                {governance ? (
                  <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
                        {governance.mode}
                      </Badge>
                      <Badge className="border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
                        {governance.product_repo_writes_allowed
                          ? "Product writes enabled"
                          : "Product writes disabled"}
                      </Badge>
                      <Badge className="border-violet-400/40 bg-violet-400/10 text-violet-200">
                        {governance.shared_scaffold_only
                          ? "Shared scaffolds only"
                          : "Expanded scaffold scope"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-zinc-300">
                      {governance.notes.join(" ")}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Scaffold root {governance.scaffold_root}
                    </p>
                  </div>
                ) : null}

                {reviewItems.length ? (
                  <div className="space-y-4">
                    {reviewItems.map((item) => {
                      const decision = decisionById[item.review_id] || "";
                      const reasonOptions = decision
                        ? reasonCodeOptions.filter((reason) =>
                            reason.decisions.includes(decision)
                          )
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
                                  {item.repo_or_domain}
                                </p>
                                <Badge className="border-violet-400/40 bg-violet-400/10 text-violet-200">
                                  {item.evaluator_class}
                                </Badge>
                                <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
                                  {item.score_status}
                                </Badge>
                                {item.promotion_candidate ? (
                                  <Badge
                                    className={
                                      item.promotion_candidate.promotion_ready
                                        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                                        : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                                    }
                                  >
                                    {item.promotion_candidate.promotion_ready
                                      ? "promotion-ready"
                                      : "needs-evidence"}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
                                <span>Objective {formatScore(item.objective_score)}</span>
                                <span>Priority {formatScore(item.priority_score)}</span>
                                <span>Confidence {formatRate(item.confidence)}</span>
                                <span>Generated {formatTimestamp(item.generated_at)}</span>
                              </div>
                              <p className="text-sm text-zinc-300">
                                {item.recommended_experiment}
                              </p>
                              <p className="text-xs text-zinc-500">
                                Signal mix {item.signal_class_summary}
                              </p>
                              {item.promotion_candidate ? (
                                <p className="text-xs text-zinc-500">
                                  Promotion {item.promotion_candidate.recommendation_class}:{" "}
                                  {item.promotion_candidate.promotion_reason} (
                                  {item.promotion_candidate.approved_runs}/
                                  {item.promotion_candidate.reviewed_runs} approvals,{" "}
                                  {formatRate(item.promotion_candidate.approval_rate)})
                                </p>
                              ) : null}
                              {item.proposed_scaffold?.markdown_path ? (
                                <p className="text-xs text-zinc-500">
                                  Draft scaffold {item.proposed_scaffold.markdown_path}
                                </p>
                              ) : null}
                              {item.evidence_refs.length ? (
                                <p className="text-xs text-zinc-500">
                                  Evidence {item.evidence_refs.slice(0, 3).join(" • ")}
                                </p>
                              ) : null}
                            </div>

                            <div className="grid gap-3 md:w-[320px]">
                              <div className="grid gap-2">
                                <Select
                                  value={decision}
                                  onValueChange={(value) =>
                                    setDecisionById((prev) => ({
                                      ...prev,
                                      [item.review_id]:
                                        value as GrowthResearchDecision,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="border-zinc-700 bg-zinc-950 text-zinc-100">
                                    <SelectValue placeholder="Decision" />
                                  </SelectTrigger>
                                  <SelectContent>
                                      {decisionLabels.map((label) => (
                                      <SelectItem key={label.id} value={label.id}>
                                        {label.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                <Select
                                  value={reasonById[item.review_id] || ""}
                                  onValueChange={(value) =>
                                    setReasonById((prev) => ({
                                      ...prev,
                                      [item.review_id]: value,
                                    }))
                                  }
                                  disabled={!decision}
                                >
                                  <SelectTrigger className="border-zinc-700 bg-zinc-950 text-zinc-100">
                                    <SelectValue placeholder="Reason code" />
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

                              <Textarea
                                value={notesById[item.review_id] || ""}
                                onChange={(event) =>
                                  setNotesById((prev) => ({
                                    ...prev,
                                    [item.review_id]: event.target.value,
                                  }))
                                }
                                placeholder="Optional review notes"
                                className="min-h-[88px] border-zinc-700 bg-zinc-950 text-zinc-100"
                              />

                              <Button
                                onClick={() => void submitReview(item.review_id)}
                                disabled={submitState[item.review_id]}
                                className="bg-cyan-500 text-black hover:bg-cyan-400"
                              >
                                {submitState[item.review_id] ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Submit Review
                              </Button>

                              {feedbackById[item.review_id] ? (
                                <div className="rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
                                  {feedbackById[item.review_id]}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-black/40 px-4 py-6 text-sm text-zinc-400">
                    <div className="flex items-center gap-2 text-zinc-200">
                      <Clock3 className="h-4 w-4 text-cyan-300" />
                      No pending growth-research reviews right now.
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      The weekly lane will populate this inbox after the next
                      successful `growth-research` run.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-black/40 px-4 py-6 text-sm text-zinc-400">
                <div className="flex items-center gap-2 text-zinc-200">
                  <AlertTriangle className="h-4 w-4 text-cyan-300" />
                  No growth-research snapshot is available yet.
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
