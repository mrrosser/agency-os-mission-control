"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import {
  AUTONOMY_BUSINESSES,
  AUTONOMY_MODES,
  type AutonomyBusinessId,
  type AutonomyMode,
  type AutonomyPolicy,
} from "@/lib/agents/autonomy-policy";

const MODE_COPY: Record<AutonomyMode, { label: string; detail: string }> = {
  assist: {
    label: "Assist",
    detail: "Research, recommendations, and drafts. You execute the work.",
  },
  supervised: {
    label: "Supervised",
    detail: "Agents organize and stage safe work for your review.",
  },
  autonomous_safe: {
    label: "Autonomous (safe)",
    detail: "Agents may run allowlisted internal tasks with complete trust evidence.",
  },
};

interface PolicyResponse {
  policy?: AutonomyPolicy;
  error?: string;
  replayed?: boolean;
}

export function AutonomyPolicyControls() {
  const { user } = useAuth();
  const [policy, setPolicy] = useState<AutonomyPolicy | null>(null);
  const [businessModes, setBusinessModes] = useState<Record<AutonomyBusinessId, AutonomyMode> | null>(null);
  const [globalKillSwitch, setGlobalKillSwitch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/agents/autonomy-policy", { method: "GET", headers });
      const payload = await readApiJson<PolicyResponse>(response);
      if (!response.ok || !payload.policy) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload.error || `Autonomy policy unavailable (${response.status}${cid ? ` cid=${cid}` : ""})`);
      }
      setPolicy(payload.policy);
      setBusinessModes(payload.policy.businessModes);
      setGlobalKillSwitch(payload.policy.globalKillSwitch);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load autonomy controls");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void loadPolicy();
  }, [loadPolicy, user]);

  const dirty = useMemo(() => {
    if (!policy || !businessModes) return false;
    return (
      globalKillSwitch !== policy.globalKillSwitch ||
      (Object.keys(AUTONOMY_BUSINESSES) as AutonomyBusinessId[]).some(
        (businessId) => businessModes[businessId] !== policy.businessModes[businessId]
      )
    );
  }, [businessModes, globalKillSwitch, policy]);

  const savePolicy = useCallback(async () => {
    if (!user || !policy || !businessModes || !dirty) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey });
      const response = await fetch("/api/agents/autonomy-policy", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          expectedVersion: policy.version,
          globalKillSwitch,
          businessModes,
          executionEnvelope: {
            agentId: "mission-control/operator",
            delegatedBy: "owner",
            scope: ["agent.autonomy_policy.update"],
            trustLevel: "high",
            evidenceRef: "operator:agent-nexus",
          },
          idempotencyKey,
        }),
      });
      const payload = await readApiJson<PolicyResponse>(response);
      if (!response.ok || !payload.policy) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload.error || `Autonomy policy update failed (${response.status}${cid ? ` cid=${cid}` : ""})`);
      }
      setPolicy(payload.policy);
      setBusinessModes(payload.policy.businessModes);
      setGlobalKillSwitch(payload.policy.globalKillSwitch);
      setFeedback(payload.replayed ? "Policy already saved." : "Autonomy policy saved.");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save autonomy policy");
    } finally {
      setSaving(false);
    }
  }, [businessModes, dirty, globalKillSwitch, policy, user]);

  return (
    <Card className="border-cyan-500/20 bg-zinc-950/90">
      <CardHeader className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
              Organization autonomy
            </CardTitle>
            <p className="max-w-3xl text-xs leading-5 text-zinc-400">
              Choose how far agents can carry internal work for each organization. Email sends, public publishing,
              calls, SMS, spending, contracts, pricing, final submissions, and external calendar bookings always need
              your approval.
            </p>
          </div>
          {policy ? <Badge className="border-zinc-700 bg-zinc-900 text-zinc-300">Policy v{policy.version}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading autonomy policy…
          </div>
        ) : error && !businessModes ? (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-3">
                <p>{error}</p>
                <Button size="sm" variant="outline" onClick={() => void loadPolicy()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        ) : businessModes ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {(Object.keys(AUTONOMY_BUSINESSES) as AutonomyBusinessId[]).map((businessId) => (
                <div key={businessId} className="rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <p className="font-medium text-white">{AUTONOMY_BUSINESSES[businessId]}</p>
                  <p className="mt-1 text-xs text-zinc-500">{MODE_COPY[businessModes[businessId]].detail}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={`${AUTONOMY_BUSINESSES[businessId]} autonomy mode`}>
                    {AUTONOMY_MODES.map((mode) => {
                      const selected = businessModes[businessId] === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setBusinessModes((current) => current ? { ...current, [businessId]: mode } : current)}
                          className={`min-h-11 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                            selected
                              ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-white"
                          }`}
                        >
                          {MODE_COPY[mode].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-rose-500/20 bg-rose-950/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium text-white">
                  <LockKeyhole className="h-4 w-4 text-rose-300" /> Global execution pause
                </p>
                <p className="text-xs text-zinc-400">Immediately blocks autonomous execution across both organizations.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={globalKillSwitch}
                onClick={() => setGlobalKillSwitch((current) => !current)}
                className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
                  globalKillSwitch ? "border-rose-400 bg-rose-500" : "border-zinc-700 bg-zinc-800"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    globalKillSwitch ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
                <span className="sr-only">{globalKillSwitch ? "Resume autonomous execution" : "Pause autonomous execution"}</span>
              </button>
            </div>

            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            {feedback ? <p className="text-sm text-emerald-300">{feedback}</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500">
                {policy?.updatedAt ? `Last updated ${new Date(policy.updatedAt).toLocaleString()}` : "Using fail-safe defaults"}
              </p>
              <Button onClick={() => void savePolicy()} disabled={!dirty || saving} className="min-h-11 bg-cyan-500 text-black hover:bg-cyan-400">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save policy
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
