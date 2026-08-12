"use client";

import { useState } from "react";
import { Loader2, Plus, ShieldCheck } from "lucide-react";
import { ApplicationReviewDesk } from "@/components/application-review-desk";
import {
  ApplicationDeskWorkspaceProvider,
  useApplicationDeskWorkspaces,
} from "@/components/providers/application-desk-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import { PREPARED_APPLICATION_WORKSPACE_ID } from "@/lib/application-desk";

const EXPECTED_PREPARED_TITLES = [
  "SUNO Nursing Building Interior",
  "SUNO Nursing Building Exterior",
  "Water Connects Us",
] as const;

interface PreparedApplicationImportPayload {
  ok: boolean;
  dryRun: boolean;
  cases: Array<{ opportunityId: string; title: string }>;
  actions: Array<{
    opportunityId: string;
    action: "would_upsert" | "upserted";
  }>;
  error?: string;
}

async function requestPreparedImport(
  user: NonNullable<ReturnType<typeof useAuth>["user"]>,
  dryRun: boolean,
): Promise<PreparedApplicationImportPayload> {
  const headers = await buildAuthHeaders(user, {
    workspaceId: PREPARED_APPLICATION_WORKSPACE_ID,
    idempotencyKey: `prepared-application-import-${dryRun ? "preview" : "apply"}`,
  });
  const response = await fetch("/api/application-desk/import-prepared", {
    method: "POST",
    headers,
    body: JSON.stringify({ dryRun }),
    cache: "no-store",
  });
  const payload = await readApiJson<PreparedApplicationImportPayload>(response);
  if (!response.ok) {
    throw new Error(payload.error || "Prepared application import failed.");
  }
  return payload;
}

function ApplicationDeskPageContent() {
  const { user } = useAuth();
  const { loading: workspaceLoading, error: workspaceError, workspaces } =
    useApplicationDeskWorkspaces();
  const [canLoadPrepared, setCanLoadPrepared] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);

  const preparedWorkspaceAvailable = workspaces.some(
    (workspace) => workspace.id === PREPARED_APPLICATION_WORKSPACE_ID,
  );

  const loadPreparedApplications = async () => {
    if (!user || !canLoadPrepared || !preparedWorkspaceAvailable) return;
    setImporting(true);
    setStatusText(null);
    try {
      const preview = await requestPreparedImport(user, true);
      const titles = preview.cases.map((preparedCase) => preparedCase.title);
      if (
        !preview.ok ||
        !preview.dryRun ||
        titles.length !== EXPECTED_PREPARED_TITLES.length ||
        !EXPECTED_PREPARED_TITLES.every((title, index) => titles[index] === title)
      ) {
        throw new Error("Prepared application preview did not match the expected three cases.");
      }

      const confirmed = window.confirm(
        [
          "Load these 3 applications into your internal review desk?",
          "",
          ...titles.map((title, index) => `${index + 1}. ${title}`),
          "",
          "This creates internal review records only. It does not open or submit a form, pay a fee, sign, attest, accept terms, update an account, or send a message.",
        ].join("\n"),
      );
      if (!confirmed) {
        setStatusText("Preview canceled. No application records were changed.");
        return;
      }

      const applied = await requestPreparedImport(user, false);
      if (
        !applied.ok ||
        applied.dryRun ||
        applied.actions.length !== EXPECTED_PREPARED_TITLES.length ||
        applied.actions.some((action) => action.action !== "upserted")
      ) {
        throw new Error("Prepared applications were not fully loaded into the review desk.");
      }
      setRefreshKey((current) => current + 1);
      setStatusText(
        "Loaded 3 prepared applications for internal review. No external submission or communication occurred.",
      );
    } catch (error) {
      setStatusText(
        error instanceof Error ? error.message : "Prepared application import failed.",
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black/20 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-cyan-400/15 bg-zinc-950/80 p-5 shadow-2xl shadow-cyan-950/10 sm:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/80">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Velvet Circuit review queue
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Application Desk
              </h1>
              <p className="text-sm leading-6 text-zinc-400 sm:text-base">
                Review art calls, gallery opportunities, RT.Solutions work, and Marcus job leads from one place.
                Approvals here authorize internal preparation only—not browser entry or final submission.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
              disabled={
                importing || workspaceLoading || !preparedWorkspaceAvailable || !canLoadPrepared
              }
              onClick={() => void loadPreparedApplications()}
            >
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {importing ? "Loading prepared applications…" : "Load 3 prepared applications"}
            </Button>
          </div>
          {workspaceError ? (
            <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
              {workspaceError}
            </p>
          ) : null}
          {statusText ? (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200">
              {statusText}
            </p>
          ) : null}
        </header>

        <section className="rounded-2xl border border-white/10 bg-zinc-950/75 p-4 sm:p-6">
          <ApplicationReviewDesk
            refreshKey={refreshKey}
            onPreparedWorkspaceCanDecideChange={setCanLoadPrepared}
          />
        </section>
      </div>
    </div>
  );
}

export default function ApplicationDeskPage() {
  return (
    <ApplicationDeskWorkspaceProvider>
      <ApplicationDeskPageContent />
    </ApplicationDeskWorkspaceProvider>
  );
}
