"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useApplicationDeskWorkspaces } from "@/components/providers/application-desk-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { buildAuthHeaders } from "@/lib/api/client";
import {
  applicationDeskWorkspaceDisplayName,
  isApplicationDeskWorkspace,
  isApplicationReviewVisibleForStatus,
  PREPARED_APPLICATION_WORKSPACE_ID,
} from "@/lib/application-desk";
import type {
  ApplicationReviewDecisionKind,
  ApplicationReviewItem,
  ApplicationReviewOperatorStatusFilter,
  ApplicationReviewStatus,
  ArtistOpportunityLane,
} from "@/lib/application-desk";
import type { ApplicationDeskWorkspace as Workspace } from "@/lib/application-desk";

const fieldClassName =
  "border-white/15 bg-black/30 text-white placeholder:text-slate-400 focus-visible:border-[#00ffff]/50 focus-visible:ring-[#00ffff]/30";
const actionButtonClassName =
  "border-white/15 bg-white/10 text-white hover:border-[#00ffff]/50 hover:bg-[#00ffff]/10 hover:text-[#dffcff]";

const decisionLabels: Record<ApplicationReviewDecisionKind, string> = {
  approve_for_preparation: "Approve for preparation",
  request_changes: "Request changes",
  defer: "Defer",
  reject: "Reject",
};

const applicantTrackLabels: Record<ApplicationReviewItem["applicantTrack"], string> = {
  marcus_artist: "Marcus Rosser · Artist",
  rosser_gallery: "Rosser Gallery",
  rt_solutions: "RT.Solutions",
  marcus_personal_job: "Marcus Rosser · Jobs",
  needs_owner_assignment: "Needs owner assignment",
};

const statusTone: Record<ApplicationReviewStatus, string> = {
  needs_review: "border-[#ffd700]/30 bg-[#ffd700]/10 text-[#ffe58e]",
  approved_for_preparation: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  changes_requested: "border-[#00ffff]/30 bg-[#00ffff]/10 text-[#9af7ff]",
  deferred: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  rejected: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  stale: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  expired: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

const statusLabels: Record<ApplicationReviewStatus, string> = {
  needs_review: "needs review",
  approved_for_preparation: "approved for preparation",
  changes_requested: "changes requested",
  deferred: "deferred",
  rejected: "rejected",
  stale: "stale",
  expired: "expired",
};

const statusFilterOptions: Array<{
  value: Exclude<ApplicationReviewOperatorStatusFilter, "all">;
  label: string;
}> = [
  { value: "needs_review", label: "Needs review" },
  { value: "expired", label: "Expired" },
];

interface ApplicationReviewDeskProps {
  /** Increment after current-workspace discovery to reload every workspace lane. */
  refreshKey?: number;
  /** Reports whether the prepared Marcus workspace role may record review decisions. */
  onPreparedWorkspaceCanDecideChange?: (canDecide: boolean) => void;
}

interface ApplicationReviewPayload {
  items: ApplicationReviewItem[];
  canDecide: boolean;
  error?: string;
}

interface WorkspaceReviewResult {
  workspace: Workspace;
  items: ApplicationReviewItem[];
  canDecide: boolean;
}

interface ReviewRow {
  item: ApplicationReviewItem;
  workspace: Workspace;
  canDecide: boolean;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function formatFee(feeUsd: number | null): string {
  if (feeUsd === null) return "Fee not listed";
  if (feeUsd === 0) return "No fee";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(feeUsd);
}

function parseDeadline(deadline: string | null): Date | null {
  if (!deadline) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(deadline)
    ? `${deadline}T12:00:00`
    : deadline;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDeadline(deadline: string | null): string {
  const parsed = parseDeadline(deadline);
  if (!deadline) return "No deadline listed";
  if (!parsed) return deadline;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function dueLabel(item: ApplicationReviewItem): string | null {
  if (item.deadlineLifecycle?.overdueDays !== null && item.deadlineLifecycle?.overdueDays !== undefined) {
    return `${item.deadlineLifecycle.overdueDays}d overdue`;
  }
  const parsed = parseDeadline(item.opportunity.deadline);
  if (!parsed) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  const days = Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

function isDueSoon(item: ApplicationReviewItem): boolean {
  const parsed = parseDeadline(item.opportunity.deadline);
  if (!parsed) return false;
  const delta = parsed.getTime() - Date.now();
  return delta >= 0 && delta <= 14 * 86_400_000;
}

function missingRequirementLabels(item: ApplicationReviewItem): string[] {
  const labels = new Map(
    item.opportunity.requirements.map((requirement) => [requirement.key, requirement.label]),
  );
  return item.opportunity.missingRequirementKeys.map(
    (key) => labels.get(key) || humanize(key),
  );
}

function safeOfficialListingUrl(item: ApplicationReviewItem): string | null {
  if (item.opportunity.sourceOfficial !== true) return null;
  try {
    const target = new URL(item.opportunity.url);
    if (target.protocol !== "https:" || target.username || target.password) return null;
    target.hash = "";
    return target.toString();
  } catch {
    return null;
  }
}

function confirmationMessage(
  item: ApplicationReviewItem,
  decisionKind: ApplicationReviewDecisionKind,
): string | null {
  if (decisionKind === "approve_for_preparation") {
    return [
      `Approve “${item.opportunity.title}” for internal preparation?`,
      "",
      "This records an internal planning decision so Velvet Circuit can continue drafting and gathering missing evidence.",
      "",
      "It does not open, fill, save, or submit a provider form; pay a fee; sign; attest; accept terms; change an account; or send any communication.",
    ].join("\n");
  }
  if (decisionKind === "reject") {
    return [
      `Reject “${item.opportunity.title}”?`,
      "",
      "This records an internal review decision only. It does not contact the organization, submit anything, or change an external account.",
    ].join("\n");
  }
  return null;
}

export function ApplicationReviewDesk({
  refreshKey = 0,
  onPreparedWorkspaceCanDecideChange,
}: ApplicationReviewDeskProps) {
  const { user } = useAuth();
  const { workspaces } = useApplicationDeskWorkspaces();
  const requestSequence = useRef(0);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [canDecideByWorkspace, setCanDecideByWorkspace] = useState<Record<string, boolean>>({});
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [applicantTrackFilter, setApplicantTrackFilter] = useState("all");
  const [laneFilter, setLaneFilter] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<ApplicationReviewOperatorStatusFilter>("all");
  const [noteByReviewId, setNoteByReviewId] = useState<Record<string, string>>({});
  const [deferDateByReviewId, setDeferDateByReviewId] = useState<Record<string, string>>({});
  const [savingByReviewId, setSavingByReviewId] = useState<Record<string, boolean>>({});
  const [feedbackByReviewId, setFeedbackByReviewId] = useState<Record<string, string>>({});

  const accessibleWorkspaces = useMemo(
    () => workspaces.filter((workspace) => isApplicationDeskWorkspace(workspace)),
    [workspaces],
  );

  const loadReviews = useCallback(
    async (mode: "initial" | "refresh" = "refresh"): Promise<void> => {
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;

      if (!user || accessibleWorkspaces.length === 0) {
        setRows([]);
        setLoadErrors([]);
        setCanDecideByWorkspace({});
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);

      const settled = await Promise.allSettled(
        accessibleWorkspaces.map(async (workspace): Promise<WorkspaceReviewResult> => {
          const headers = await buildAuthHeaders(user, { workspaceId: workspace.id });
          const response = await fetch("/api/application-desk/reviews", {
            method: "GET",
            headers,
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => ({}))) as Partial<ApplicationReviewPayload>;
          if (!response.ok) {
            const correlationId = response.headers.get("x-correlation-id");
            throw new Error(
              `${applicationDeskWorkspaceDisplayName(workspace)}: ${payload.error || `review load failed (${response.status})`}${
                correlationId ? ` · ${correlationId}` : ""
              }`,
            );
          }
          return {
            workspace,
            items: Array.isArray(payload.items) ? payload.items : [],
            canDecide: payload.canDecide === true,
          };
        }),
      );

      if (sequence !== requestSequence.current) return;

      const nextRows: ReviewRow[] = [];
      const nextErrors: string[] = [];
      const nextCanDecideByWorkspace: Record<string, boolean> = {};
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          nextCanDecideByWorkspace[result.value.workspace.id] = result.value.canDecide;
          nextRows.push(
            ...result.value.items.map((item) => ({
              item,
              workspace: result.value.workspace,
              canDecide: result.value.canDecide,
            })),
          );
          return;
        }
        const workspace = accessibleWorkspaces[index];
        nextErrors.push(
          result.reason instanceof Error
            ? result.reason.message
            : `${workspace ? applicationDeskWorkspaceDisplayName(workspace) : "Workspace"}: review load failed`,
        );
      });

      nextRows.sort((left, right) => {
        const leftDeadline = parseDeadline(left.item.opportunity.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightDeadline = parseDeadline(right.item.opportunity.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
        return right.item.opportunity.fitScore - left.item.opportunity.fitScore;
      });

      setRows(nextRows);
      setLoadErrors(nextErrors);
      setCanDecideByWorkspace(nextCanDecideByWorkspace);
      setLoading(false);
      setRefreshing(false);
    },
    [accessibleWorkspaces, user],
  );

  useEffect(() => {
    void loadReviews("initial");
  }, [loadReviews, refreshKey]);

  useEffect(() => {
    onPreparedWorkspaceCanDecideChange?.(
      canDecideByWorkspace[PREPARED_APPLICATION_WORKSPACE_ID] === true,
    );
  }, [canDecideByWorkspace, onPreparedWorkspaceCanDecideChange]);

  const applicantTracks = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.item.applicantTrack))).sort() as Array<
        ApplicationReviewItem["applicantTrack"]
      >,
    [rows],
  );

  const lanes = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.item.opportunity.lane))).sort() as ArtistOpportunityLane[],
    [rows],
  );
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (workspaceFilter === "all" || row.workspace.id === workspaceFilter) &&
          (applicantTrackFilter === "all" || row.item.applicantTrack === applicantTrackFilter) &&
          (laneFilter === "all" || row.item.opportunity.lane === laneFilter) &&
          isApplicationReviewVisibleForStatus(
            row.item,
            statusFilter,
          ),
      ),
    [applicantTrackFilter, laneFilter, rows, statusFilter, workspaceFilter],
  );

  const currentQueueRows = rows.filter((row) =>
    isApplicationReviewVisibleForStatus(row.item, "all"),
  );
  const dueSoonCount = currentQueueRows.filter((row) => isDueSoon(row.item)).length;
  const blockedCount = currentQueueRows.filter(
    (row) =>
      row.item.applicantTrack === "needs_owner_assignment" ||
      row.item.reviewBlockers.length > 0 ||
      row.item.opportunity.missingRequirementKeys.length > 0,
  ).length;
  const readyCount = currentQueueRows.filter(
    (row) => row.item.approvalEligible && row.item.applicantTrack !== "needs_owner_assignment",
  ).length;

  const recordDecision = async (
    row: ReviewRow,
    decisionKind: ApplicationReviewDecisionKind,
  ): Promise<void> => {
    if (!user || !row.canDecide) return;
    const reviewId = row.item.reviewId;
    if (
      decisionKind === "approve_for_preparation" &&
      row.item.applicantTrack === "needs_owner_assignment"
    ) {
      setFeedbackByReviewId((current) => ({
        ...current,
        [reviewId]: "Assign this opportunity to an applicant before approving preparation.",
      }));
      return;
    }
    const deferUntil = (deferDateByReviewId[reviewId] || "").trim();
    if (decisionKind === "defer" && !deferUntil) {
      setFeedbackByReviewId((current) => ({
        ...current,
        [reviewId]: "Choose a defer-until date before recording this decision.",
      }));
      return;
    }

    const prompt = confirmationMessage(row.item, decisionKind);
    if (prompt && !window.confirm(prompt)) return;

    const decisionId = `decision_${crypto.randomUUID()}`;
    setSavingByReviewId((current) => ({ ...current, [reviewId]: true }));
    setFeedbackByReviewId((current) => ({ ...current, [reviewId]: "" }));

    try {
      const headers = await buildAuthHeaders(user, {
        workspaceId: row.workspace.id,
        idempotencyKey: decisionId,
      });
      const response = await fetch(
        `/api/application-desk/reviews/${encodeURIComponent(reviewId)}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          cache: "no-store",
          body: JSON.stringify({
            opportunityId: row.item.opportunityId,
            decisionId,
            decisionKind,
            expectedReviewRoundId: row.item.reviewRoundId,
            expectedActionFingerprint: row.item.actionFingerprint,
            expectedArtifactFingerprint: row.item.artifactFingerprint,
            expectedLatestDecisionId: row.item.latestDecisionId,
            note: (noteByReviewId[reviewId] || "").trim(),
            deferUntil: decisionKind === "defer" ? deferUntil : null,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const correlationId = response.headers.get("x-correlation-id");
        throw new Error(
          `${payload.error || `Decision failed (${response.status})`}${
            correlationId ? ` · ${correlationId}` : ""
          }`,
        );
      }

      setFeedbackByReviewId((current) => ({
        ...current,
        [reviewId]: `${decisionLabels[decisionKind]} recorded. No external submission or communication occurred.`,
      }));
      await loadReviews("refresh");
    } catch (error) {
      setFeedbackByReviewId((current) => ({
        ...current,
        [reviewId]: error instanceof Error ? error.message : "Failed to record review decision.",
      }));
    } finally {
      setSavingByReviewId((current) => ({ ...current, [reviewId]: false }));
    }
  };

  return (
    <div className="space-y-5" data-testid="application-review-desk">
      <div className="rounded-2xl border border-[#ffd700]/25 bg-[#ffd700]/10 p-4 text-sm leading-6 text-slate-200">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#ffe58e]" aria-hidden="true" />
          <div>
            <p className="font-medium text-white">Approval is limited to internal preparation planning.</p>
            <p className="mt-1">
              It does not open, fill, save, or submit a provider form; pay a fee; sign; attest;
              accept terms; create or update an account; or send a communication. A future browser
              milestone requires a separate reviewed approval before it may even populate fields.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current queue" value={String(currentQueueRows.length)} />
        <Metric label="Approval eligible" value={String(readyCount)} />
        <Metric label="Due within 14 days" value={String(dueSoonCount)} />
        <Metric label="Needs requirements" value={String(blockedCount)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <FilterSelect
          label="Workspace"
          value={workspaceFilter}
          onValueChange={setWorkspaceFilter}
          options={accessibleWorkspaces.map((workspace) => ({
            value: workspace.id,
            label: applicationDeskWorkspaceDisplayName(workspace),
          }))}
        />
        <FilterSelect
          label="Applicant track"
          allLabel="All applicant tracks"
          value={applicantTrackFilter}
          onValueChange={setApplicantTrackFilter}
          options={applicantTracks.map((track) => ({ value: track, label: applicantTrackLabels[track] }))}
        />
        <FilterSelect
          label="Lane"
          value={laneFilter}
          onValueChange={setLaneFilter}
          options={lanes.map((lane) => ({ value: lane, label: humanize(lane) }))}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as ApplicationReviewOperatorStatusFilter)
          }
          options={statusFilterOptions}
        />
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className={`w-full lg:w-auto ${actionButtonClassName}`}
            disabled={loading || refreshing}
            onClick={() => void loadReviews("refresh")}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Refresh desk
          </Button>
        </div>
      </div>

      {loadErrors.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Some workspaces could not be loaded.</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-100/80">
                {loadErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400" aria-live="polite">
        Showing {filteredRows.length} of {rows.length} review items across {accessibleWorkspaces.length} accessible
        workspace{accessibleWorkspaces.length === 1 ? "" : "s"}. Opportunities 6–14 days overdue appear only
        under the Expired status; older items are soft-archived without deleting history.
      </p>

      <div className="space-y-4">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-white/10 bg-black/25">
            <Loader2 className="h-7 w-7 animate-spin text-[#00ffff]" aria-label="Loading application reviews" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm text-slate-300">
            <p className="font-medium text-white">No reviews match these filters.</p>
            <p className="mt-1">Run discovery for the current workspace or clear a filter to see other lanes.</p>
          </div>
        ) : (
          filteredRows.map((row) => (
            <ReviewCard
              key={`${row.workspace.id}:${row.item.reviewId}`}
              row={row}
              note={noteByReviewId[row.item.reviewId] || row.item.decisionNote || ""}
              deferDate={deferDateByReviewId[row.item.reviewId] || row.item.deferUntil?.slice(0, 10) || ""}
              saving={Boolean(savingByReviewId[row.item.reviewId])}
              feedback={feedbackByReviewId[row.item.reviewId] || ""}
              onNoteChange={(value) =>
                setNoteByReviewId((current) => ({ ...current, [row.item.reviewId]: value }))
              }
              onDeferDateChange={(value) =>
                setDeferDateByReviewId((current) => ({ ...current, [row.item.reviewId]: value }))
              }
              onDecision={(decisionKind) => void recordDecision(row, decisionKind)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#00ffff]/70">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onValueChange,
}: {
  label: string;
  allLabel?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
      <span>{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={fieldClassName} aria-label={`${label} filter`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {allLabel || (label === "Status" ? "All statuses" : `All ${label.toLowerCase()}s`)}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ReviewCard({
  row,
  note,
  deferDate,
  saving,
  feedback,
  onNoteChange,
  onDeferDateChange,
  onDecision,
}: {
  row: ReviewRow;
  note: string;
  deferDate: string;
  saving: boolean;
  feedback: string;
  onNoteChange: (value: string) => void;
  onDeferDateChange: (value: string) => void;
  onDecision: (decisionKind: ApplicationReviewDecisionKind) => void;
}) {
  const { item, workspace, canDecide } = row;
  const opportunity = item.opportunity;
  const missing = missingRequirementLabels(item);
  const due = dueLabel(item);
  const officialListingUrl = safeOfficialListingUrl(item);
  const needsOwnerAssignment = item.applicantTrack === "needs_owner_assignment";
  const approvalDisabled = saving || !canDecide || !item.approvalEligible || needsOwnerAssignment;

  return (
    <Card
      className="overflow-hidden border-white/10 bg-black/25 shadow-[0_16px_50px_rgba(0,0,0,0.28)]"
      data-testid="application-review-card"
      data-workspace-id={workspace.id}
      data-applicant-track={item.applicantTrack}
      data-lane={opportunity.lane}
      data-status={item.status}
    >
      <CardHeader className="space-y-4 border-b border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-white/15 bg-white/10 text-slate-100">
                {applicationDeskWorkspaceDisplayName(workspace)}
              </Badge>
              <Badge className="border border-[#00ffff]/25 bg-[#00ffff]/10 text-[#9af7ff]">
                {humanize(opportunity.lane)}
              </Badge>
              <Badge
                className={
                  needsOwnerAssignment
                    ? "border border-amber-400/35 bg-amber-400/10 text-amber-100"
                    : "border border-violet-400/25 bg-violet-400/10 text-violet-100"
                }
              >
                {applicantTrackLabels[item.applicantTrack]}
              </Badge>
              <Badge className={`border ${statusTone[item.status]}`}>{statusLabels[item.status]}</Badge>
              {!canDecide && (
                <Badge className="border border-slate-500/30 bg-slate-500/10 text-slate-300">read only</Badge>
              )}
            </div>
            <div>
              <h3 className="break-words text-lg font-semibold text-white">{opportunity.title}</h3>
              <p className="text-sm text-slate-300">{opportunity.organization}</p>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-slate-300">{opportunity.summary}</p>
          </div>
          {officialListingUrl ? (
            <a
              href={officialListingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-[#00ffff]/25 bg-[#00ffff]/10 px-3 text-sm font-medium text-[#9af7ff] transition-colors hover:bg-[#00ffff]/15"
            >
              Open official listing
              <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-500/25 bg-slate-500/10 px-3 text-sm text-slate-400">
              Listing link unavailable
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoChip
            icon={<CalendarClock className="h-4 w-4 text-[#ffd700]" aria-hidden="true" />}
            label="Deadline"
            value={`${formatDeadline(opportunity.deadline)}${due ? ` · ${due}` : ""}`}
          />
          <InfoChip
            icon={<CircleDollarSign className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
            label="Application fee"
            value={formatFee(opportunity.feeUsd)}
          />
          <InfoChip
            icon={<CheckCircle2 className="h-4 w-4 text-[#00ffff]" aria-hidden="true" />}
            label="Fit"
            value={`${opportunity.fitScore} · ${opportunity.fitLabel}`}
          />
          <InfoChip
            icon={<ShieldCheck className="h-4 w-4 text-violet-300" aria-hidden="true" />}
            label="Readiness"
            value={
              needsOwnerAssignment
                ? "Assign an applicant before approval"
                : item.approvalEligible
                ? "Eligible for preparation approval"
                : opportunity.applicationReady
                  ? "Review blockers remain"
                  : "Application packet not ready"
            }
          />
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <DetailList
              title="Missing requirements"
              values={missing}
              emptyText="No missing requirements recorded."
              warning={missing.length > 0}
            />
            <DetailList
              title="Preparation blockers"
              values={item.preparationBlockers.map(humanize)}
              emptyText="No blockers to internal preparation approval."
              warning={item.preparationBlockers.length > 0}
            />
            <DetailList
              title="Remaining readiness work"
              values={[...item.reviewBlockers, ...item.driftReasons].map(humanize)}
              emptyText="No readiness work or material drift recorded."
              warning={item.reviewBlockers.length > 0 || item.driftReasons.length > 0}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-slate-300">
            <p className="font-medium uppercase tracking-[0.15em] text-slate-400">Decision scope</p>
            <p className="mt-2">
              Approved: {item.approvalScope.length > 0 ? item.approvalScope.map(humanize).join(" · ") : "internal preparation only"}
            </p>
            <p className="mt-1 text-rose-200">
              Excluded: {item.excludedScope.length > 0 ? item.excludedScope.map(humanize).join(" · ") : "all external writes and final submission"}
            </p>
          </div>

          {item.latestDecisionKind && (
            <p className="text-xs text-slate-400">
              Latest decision: {decisionLabels[item.latestDecisionKind]}
              {item.decidedAt ? ` · ${new Date(item.decidedAt).toLocaleString()}` : ""}
              {item.deferUntil ? ` · deferred until ${formatDeadline(item.deferUntil)}` : ""}
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <label className="block space-y-2 text-sm text-slate-200">
            <span>Review note</span>
            <Textarea
              className={`min-h-24 ${fieldClassName}`}
              value={note}
              maxLength={2000}
              disabled={saving || !canDecide}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Optional correction, context, or owner action"
            />
          </label>

          <label className="block space-y-2 text-sm text-slate-200">
            <span>Defer until</span>
            <Input
              type="date"
              className={fieldClassName}
              value={deferDate}
              disabled={saving || !canDecide}
              onChange={(event) => onDeferDateChange(event.target.value)}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              disabled={approvalDisabled}
              onClick={() => onDecision("approve_for_preparation")}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Approve for preparation
            </Button>
            <Button
              type="button"
              variant="outline"
              className={actionButtonClassName}
              disabled={saving || !canDecide}
              onClick={() => onDecision("request_changes")}
            >
              Request changes
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-violet-400/30 bg-violet-400/10 text-violet-100 hover:bg-violet-400/20"
              disabled={saving || !canDecide}
              onClick={() => onDecision("defer")}
            >
              Defer
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20"
              disabled={saving || !canDecide}
              onClick={() => onDecision("reject")}
            >
              Reject
            </Button>
          </div>

          {needsOwnerAssignment && canDecide && (
            <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Preparation approval is blocked until this opportunity is assigned to Marcus Rosser,
              Rosser Gallery, RT.Solutions, or Marcus Rosser’s personal job track.
            </p>
          )}
          {!item.approvalEligible && !needsOwnerAssignment && canDecide && (
            <p className="text-xs text-amber-200">
              Preparation approval is disabled until readiness and review blockers are cleared. You can still
              request changes, defer, or reject.
            </p>
          )}
          {!canDecide && (
            <p className="text-xs text-slate-400">
              Your workspace role can view but not record decisions.
            </p>
          )}
          {feedback && (
            <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200" role="status" aria-live="polite">
              {feedback}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoChip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-sm text-white">{value}</p>
    </div>
  );
}

function DetailList({
  title,
  values,
  emptyText,
  warning,
}: {
  title: string;
  values: string[];
  emptyText: string;
  warning: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${warning ? "border-amber-400/25 bg-amber-400/5" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">{title}</p>
      {values.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-200">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-300">{emptyText}</p>
      )}
    </div>
  );
}

export default ApplicationReviewDesk;
