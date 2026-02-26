"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import type { SocialOnboardingStepId } from "@/lib/social/onboarding";

type StepState = "ready" | "needs_action";

interface SocialOnboardingStatusPayload {
  ok: boolean;
  ready: boolean;
  completedStepIds: SocialOnboardingStepId[];
  correlationId?: string;
  steps: Array<{
    id: SocialOnboardingStepId;
    label: string;
    detail: string;
    state: StepState;
    actionLabel: string | null;
    actionHref: string | null;
    canToggle: boolean;
  }>;
  pipeline: {
    drafts: {
      pendingApproval: number;
      approved: number;
      rejected: number;
      failed: number;
    };
    dispatch: {
      pendingExternalTool: number;
      dispatched: number;
      failed: number;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
    };
  };
  diagnostics: {
    status: "ok" | "warn" | "fail";
    generatedAt: string;
    checks: Array<{
      id: string;
      label: string;
      level: "required" | "recommended";
      state: "ok" | "missing" | "warning";
      detail: string;
    }>;
  };
  error?: string;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return dateTime.format(parsed);
}

export function SocialOnboardingChecklist() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [savingStep, setSavingStep] = useState<SocialOnboardingStepId | null>(null);
  const [status, setStatus] = useState<SocialOnboardingStatusPayload | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/social/onboarding/status", { headers });
      const payload = await readApiJson<SocialOnboardingStatusPayload>(response);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load social onboarding status");
      }
      setStatus(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to load social onboarding", { description: message });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const toggleStep = useCallback(
    async (stepId: SocialOnboardingStepId, completed: boolean) => {
      if (!user) return;
      setSavingStep(stepId);
      try {
        const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
        const response = await fetch("/api/social/onboarding/status", {
          method: "POST",
          headers,
          body: JSON.stringify({ stepId, completed }),
        });
        const payload = await readApiJson<{ ok?: boolean; error?: string }>(response);
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update social onboarding step");
        }
        await fetchStatus();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error("Failed to update social onboarding step", { description: message });
      } finally {
        setSavingStep(null);
      }
    },
    [fetchStatus, user]
  );

  const pendingActions = useMemo(
    () => status?.steps.filter((step) => step.state === "needs_action").length ?? 0,
    [status]
  );

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-white">Social Onboarding Checklist</CardTitle>
            <CardDescription>
              First-login to connected social accounts, approvals, and dispatch visibility.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={
                status?.ready
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/15 border-amber-500/30 text-amber-300"
              }
            >
              {status?.ready ? "Ready" : `${pendingActions} action${pendingActions === 1 ? "" : "s"}`}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
              onClick={() => void fetchStatus()}
              disabled={loading}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <p className="text-sm text-zinc-400">{loading ? "Loading social onboarding..." : "No data yet."}</p>
        ) : (
          <>
            <div className="space-y-2">
              {status.steps.map((step) => (
                <div
                  key={step.id}
                  className={`rounded-lg border p-3 ${
                    step.state === "ready"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-amber-500/20 bg-amber-500/5"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-white flex items-center gap-2">
                        {step.state === "ready" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <CircleAlert className="h-4 w-4 text-amber-300" />
                        )}
                        {step.label}
                      </p>
                      <p className="text-xs text-zinc-300">{step.detail}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {step.actionLabel && step.actionHref ? (
                        <Link href={step.actionHref} target={step.actionHref.startsWith("http") ? "_blank" : undefined}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                          >
                            {step.actionLabel}
                            {step.actionHref.startsWith("http") ? (
                              <ExternalLink className="ml-1 h-3.5 w-3.5" />
                            ) : null}
                          </Button>
                        </Link>
                      ) : null}
                      {step.canToggle ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={step.state === "ready" ? "secondary" : "default"}
                          className={
                            step.state === "ready"
                              ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                              : "bg-cyan-600 text-white hover:bg-cyan-500"
                          }
                          disabled={savingStep === step.id}
                          onClick={() => void toggleStep(step.id, step.state !== "ready")}
                        >
                          {savingStep === step.id
                            ? "Saving..."
                            : step.state === "ready"
                              ? "Mark incomplete"
                              : "Mark complete"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Pending approvals</p>
                <p className="text-xl font-semibold text-white">{status.pipeline.drafts.pendingApproval}</p>
                <p className="text-xs text-zinc-500">
                  Approved: {status.pipeline.drafts.approved} · Failed: {status.pipeline.drafts.failed}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Dispatch queue</p>
                <p className="text-xl font-semibold text-white">{status.pipeline.dispatch.pendingExternalTool}</p>
                <p className="text-xs text-zinc-500">
                  Failed: {status.pipeline.dispatch.failed} · Sent: {status.pipeline.dispatch.dispatched}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Last dispatch</p>
                <p className="text-sm font-medium text-white">
                  Success: {formatTimestamp(status.pipeline.dispatch.lastSuccessAt)}
                </p>
                <p className="text-xs text-zinc-500">
                  Failure: {formatTimestamp(status.pipeline.dispatch.lastFailureAt)}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
