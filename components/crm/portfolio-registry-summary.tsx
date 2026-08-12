import { AlertTriangle, Database, ShieldAlert, Users } from "lucide-react";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

type Props = {
  summary: PortfolioCrmRegistrySummary | null;
  loading: boolean;
  error: string | null;
};

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function date(value: string | null): string {
  if (!value) return "Not observed";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Not observed";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-black/40 p-3">
      <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-white">{number(value)}</p>
    </div>
  );
}

export function PortfolioRegistrySummary({ summary, loading, error }: Props) {
  if (loading) {
    return (
      <section
        aria-labelledby="portfolio-registry-heading"
        className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4"
        data-testid="portfolio-crm-registry"
      >
        <h2 id="portfolio-registry-heading" className="text-base font-semibold text-white">
          Portfolio contact registry
        </h2>
        <p className="mt-3 text-sm text-zinc-400">Loading canonical aggregate evidence…</p>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section
        aria-labelledby="portfolio-registry-heading"
        className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
        data-testid="portfolio-crm-registry"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="portfolio-registry-heading" className="font-semibold text-red-100">
              Portfolio registry unavailable — outreach blocked
            </h2>
            <p className="mt-1 break-words text-sm text-red-100/70">
              {error || "Canonical registry evidence was not returned."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="portfolio-registry-heading"
      className="mb-6 min-w-0 rounded-xl border border-cyan-500/20 bg-zinc-950/80 p-3 sm:p-4"
      data-testid="portfolio-crm-registry"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <h2 id="portfolio-registry-heading" className="text-base font-semibold text-white">
              Portfolio contact registry
            </h2>
          </div>
          <p className="mt-1 break-words text-xs text-zinc-400">
            Canonical Firestore registry · aggregate only · separate from the editable lead pipeline below
          </p>
          <p className="mt-1 break-words text-[11px] text-zinc-500">
            Authenticated source registry · verified {summary.registry.accessRole} access
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
          Read-only canonical
        </span>
      </div>

      <div
        className="mt-4 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3"
        role="status"
        data-testid="portfolio-crm-outreach-blocked"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-red-100">Outreach blocked</p>
          <ul className="mt-1 space-y-1 text-xs text-red-100/75">
            {summary.outreach.reasons.map((reason) => (
              <li key={reason} className="break-words">• {reason}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="People" value={summary.totals.people} />
        <Metric label="Contact points" value={summary.totals.contactPoints} />
        <Metric label="Emails" value={summary.totals.emailContactPoints} />
        <Metric label="Phones" value={summary.totals.phoneContactPoints} />
        <Metric label="Source records" value={summary.totals.sourceRecords} />
        <Metric label="Open conflicts" value={summary.totals.openConflicts} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <Users className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Segments
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-zinc-500">Rosser Gallery</dt><dd className="tabular-nums text-zinc-200">{number(summary.brands.rosser_gallery)}</dd></div>
            <div><dt className="text-zinc-500">RT.Solutions</dt><dd className="tabular-nums text-zinc-200">{number(summary.brands.rt_solutions)}</dd></div>
            <div><dt className="text-zinc-500">KGClassy</dt><dd className="tabular-nums text-zinc-200">{number(summary.brands.kgclassy)}</dd></div>
            <div><dt className="text-zinc-500">Unassigned</dt><dd className="tabular-nums text-amber-200">{number(summary.brands.unassigned)}</dd></div>
          </dl>
        </div>

        <div className="min-w-0 rounded-lg border border-zinc-800 p-3">
          <p className="text-sm font-medium text-zinc-200">Source records</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-zinc-500">Google People</dt><dd className="tabular-nums text-zinc-200">{number(summary.sources.google_people)}</dd></div>
            <div><dt className="text-zinc-500">Google Sheets</dt><dd className="tabular-nums text-zinc-200">{number(summary.sources.google_sheets)}</dd></div>
            <div><dt className="text-zinc-500">Blinq</dt><dd className="tabular-nums text-zinc-200">{number(summary.sources.blinq_csv)}</dd></div>
            <div><dt className="text-zinc-500">Other</dt><dd className="tabular-nums text-zinc-200">{number(summary.sources.other)}</dd></div>
          </dl>
        </div>

        <div className="min-w-0 rounded-lg border border-zinc-800 p-3">
          <p className="text-sm font-medium text-zinc-200">Permission evidence</p>
          <dl className="mt-2 space-y-2 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Unknown contact points</dt><dd className="tabular-nums text-amber-200">{number(summary.permissions.contactPointStates.unknown)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Opted in</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.contactPointStates.opted_in)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Opted out</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.contactPointStates.opted_out)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Reconfirm required</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.contactPointStates.reconfirm_required)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Transactional only</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.contactPointStates.transactional_only)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Other states</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.contactPointStates.other)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">No permission basis</dt><dd className="tabular-nums text-amber-200">{number(summary.permissions.sourceRecordsWithNoPermissionBasis)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Permission events</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.permissionEvents)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-zinc-500">Suppressions</dt><dd className="tabular-nums text-zinc-200">{number(summary.permissions.suppressions)}</dd></div>
          </dl>
        </div>

        <div className="min-w-0 rounded-lg border border-zinc-800 p-3">
          <p className="text-sm font-medium text-zinc-200">Registry freshness</p>
          <dl className="mt-2 space-y-2 text-xs">
            <div><dt className="text-zinc-500">People</dt><dd className="mt-0.5 break-words text-zinc-200">{date(summary.freshness.peopleUpdatedAt)}</dd></div>
            <div><dt className="text-zinc-500">Contact points</dt><dd className="mt-0.5 break-words text-zinc-200">{date(summary.freshness.contactPointsUpdatedAt)}</dd></div>
            <div><dt className="text-zinc-500">Source records</dt><dd className="mt-0.5 break-words text-zinc-200">{date(summary.freshness.sourceRecordsUpdatedAt)}</dd></div>
            <div><dt className="text-zinc-500">Observed</dt><dd className="mt-0.5 break-words text-zinc-200">{date(summary.freshness.observedAt)}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
