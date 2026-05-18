"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Pause, Play, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

type ProviderId = "meta_ads" | "google_ads";
type CampaignStatus = "active" | "paused" | "draft" | "unknown";

interface ProviderSummary {
  providerId: ProviderId;
  label: string;
  configured: boolean;
  writeEnabled: boolean;
  accountId: string | null;
  error: string | null;
}

interface CampaignRecord {
  providerId: ProviderId;
  providerLabel: string;
  campaignId: string;
  name: string;
  status: CampaignStatus;
  objective: string | null;
  dailyBudgetUsd: number | null;
  spendMonthToDateUsd: number | null;
  updatedAt: string | null;
  writeEnabled: boolean;
}

interface CampaignListResponse {
  ready: boolean;
  providers: ProviderSummary[];
  campaigns: CampaignRecord[];
}

function formatUsd(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleString();
}

function statusBadgeClass(status: CampaignStatus): string {
  if (status === "active") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (status === "paused") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (status === "draft") return "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

export function AdOpsControlCard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [actioningKey, setActioningKey] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [approvalRef, setApprovalRef] = useState("");
  const [note, setNote] = useState("");

  const loadCampaigns = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/ad-ops/campaigns?limit=12", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const data = await readApiJson<CampaignListResponse & { error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(data.error || `Failed to load ad-ops campaigns${cid ? ` cid=${cid}` : ""}`);
      }
      setProviders(data.providers || []);
      setCampaigns(data.campaigns || []);
    } catch (error) {
      toast.error("Failed to load ad ops", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const activeCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "active").length,
    [campaigns]
  );

  const configuredCount = useMemo(
    () => providers.filter((provider) => provider.configured).length,
    [providers]
  );

  async function runAction(campaign: CampaignRecord, action: "pause" | "resume" | "sync") {
    if (!user) return;
    if (action === "resume" && !approvalRef.trim()) {
      toast.error("Approval reference required", {
        description: "Resume is a spend-bearing action and must include an approval reference.",
      });
      return;
    }

    const actionKey = `${campaign.providerId}:${campaign.campaignId}:${action}`;
    setActioningKey(actionKey);
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch(
        `/api/ad-ops/campaigns/${encodeURIComponent(campaign.campaignId)}/action`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            providerId: campaign.providerId,
            action,
            approvalRef: action === "resume" ? approvalRef.trim() : undefined,
            note: note.trim() || undefined,
            evidenceRef: "mission-control:/dashboard/operations#ad-ops",
          }),
        }
      );
      const data = await readApiJson<{ error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(data.error || `Ad-ops action failed${cid ? ` cid=${cid}` : ""}`);
      }

      toast.success(`${campaign.providerLabel} ${action} sent`, {
        description: `${campaign.name} is now queued through the Mission Control ad-ops proxy.`,
      });
      await loadCampaigns();
    } catch (error) {
      toast.error("Ad-ops action failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setActioningKey(null);
    }
  }

  return (
    <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Ad Ops Control</h3>
            <p className="text-sm text-zinc-400">
              Mission Control proxy for Meta Ads and Google Ads campaign lifecycle.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="bg-zinc-900 text-zinc-300 border border-zinc-800">
              Providers {configuredCount}/{providers.length}
            </Badge>
            <Badge
              variant="secondary"
              className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
            >
              Active {activeCount}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
              onClick={() => void loadCampaigns()}
              disabled={loading}
            >
              <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Approval Reference
            </label>
            <Input
              value={approvalRef}
              onChange={(event) => setApprovalRef(event.target.value)}
              placeholder="Required for resume actions"
              className="border-zinc-800 bg-zinc-900 text-zinc-100"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Operator Note
            </label>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional reason or run note"
              className="border-zinc-800 bg-zinc-900 text-zinc-100"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <div
              key={provider.providerId}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-300"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{provider.label}</p>
                  <p className="text-xs text-zinc-500">
                    {provider.accountId ? `Account ${provider.accountId}` : "Account not configured"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      provider.configured
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                    }
                  >
                    {provider.configured ? "Configured" : "Missing"}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={
                      provider.writeEnabled
                        ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                        : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                    }
                  >
                    {provider.writeEnabled ? "Write Enabled" : "Read Only"}
                  </Badge>
                </div>
              </div>
              {provider.error && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{provider.error}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400">
            {configuredCount === 0
              ? "Configure META_ADS_CONTROL_URL or GOOGLE_ADS_CONTROL_URL to expose live campaign controls here."
              : "No campaigns were returned by the configured ad-ops providers."}
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => {
              const busy = actioningKey?.startsWith(`${campaign.providerId}:${campaign.campaignId}:`) ?? false;
              return (
                <div
                  key={`${campaign.providerId}:${campaign.campaignId}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{campaign.name}</p>
                        <Badge variant="secondary" className="bg-zinc-900 text-zinc-300 border border-zinc-800">
                          {campaign.providerLabel}
                        </Badge>
                        <Badge variant="secondary" className={statusBadgeClass(campaign.status)}>
                          {campaign.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
                        <span>Objective: {campaign.objective || "n/a"}</span>
                        <span>Daily budget: {formatUsd(campaign.dailyBudgetUsd)}</span>
                        <span>MTD spend: {formatUsd(campaign.spendMonthToDateUsd)}</span>
                        <span>Updated: {formatUpdatedAt(campaign.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                        onClick={() => void runAction(campaign, "sync")}
                      >
                        <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                        Sync
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !campaign.writeEnabled || campaign.status === "paused"}
                        className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                        onClick={() => void runAction(campaign, "pause")}
                      >
                        <Pause className="mr-2 h-3.5 w-3.5" />
                        Pause
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !campaign.writeEnabled || campaign.status === "active"}
                        className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                        onClick={() => void runAction(campaign, "resume")}
                      >
                        <Play className="mr-2 h-3.5 w-3.5" />
                        Resume
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs text-zinc-300">
          <p className="flex items-center gap-2 font-medium text-zinc-200">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Spend-bearing resume actions are approval-gated and budget-governed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
