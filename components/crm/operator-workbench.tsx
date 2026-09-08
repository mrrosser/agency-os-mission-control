"use client";

import { AfroGlyph, type AfroGlyphVariant } from "@/components/branding/AfroGlyph";
import { CRM_WORKSPACES, nextCrmWorkspace, type CrmWorkspace } from "@/lib/crm/workbench";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";
import type { RefObject } from "react";

const WORKSPACE_LABELS: Record<CrmWorkspace, { label: string; glyph: AfroGlyphVariant }> = {
  people: { label: "People", glyph: "people" },
  outreach: { label: "Outreach", glyph: "outreach" },
  share: { label: "Share cards", glyph: "network" },
  activity: { label: "Activity", glyph: "activity" },
};

type Props = {
  active: CrmWorkspace;
  onChange: (workspace: CrmWorkspace) => void;
  onAdd: () => void;
  registry: PortfolioCrmRegistrySummary | null;
  loading: boolean;
  addButtonRef?: RefObject<HTMLButtonElement | null>;
};

export function OperatorWorkbench({ active, onChange, onAdd, registry, loading, addButtonRef }: Props) {
  const metric = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString();
  return (
    <section className="crm-workbench" aria-label="CRM quick actions">
      <div className="crm-workbench-intro">
        <div>
          <p className="crm-eyebrow">Rosser Gallery · RT Solutions</p>
          <h1>Your next conversation.</h1>
          <p className="crm-intro-copy">Keep your people close. Make the next step easy.</p>
        </div>
        <a href="/dashboard/integrations" className="crm-settings-link">Connections &amp; settings ↗</a>
      </div>
      <div className="crm-quick-actions">
        <button type="button" onClick={onAdd} ref={addButtonRef}>
          <AfroGlyph variant="people" aria-hidden="true" />
          <span><strong>Add a contact</strong><small>Capture a real connection</small></span><span aria-hidden="true">＋</span>
        </button>
        <button type="button" onClick={() => onChange("outreach")}>
          <AfroGlyph variant="outreach" aria-hidden="true" />
          <span><strong>Review outreach</strong><small>Draft, audience, then approval</small></span><span aria-hidden="true">→</span>
        </button>
        <button type="button" onClick={() => onChange("share")}>
          <AfroGlyph variant="network" aria-hidden="true" />
          <span><strong>Share my card</strong><small>Your links and first-party intake</small></span><span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="crm-evidence-strip" aria-label="Canonical registry status">
        <div><strong>{metric(registry?.totals.people)}</strong><span>Registry people</span></div>
        <div><strong>{metric(registry?.totals.openConflicts)}</strong><span>Identity conflicts</span></div>
        <div><strong>{metric(registry?.permissions.contactPointStates.opted_in)}</strong><span>Opted-in contact points</span></div>
        <button type="button" onClick={() => onChange("outreach")}>
          {loading ? "Checking outreach…" : registry ? "Review outreach readiness" : "Readiness unavailable · check connection"}
        </button>
      </div>
      <p className="crm-evidence-note">Registry totals are not newsletter recipient counts. Consent and suppression checks still apply.</p>
      <div role="tablist" aria-label="CRM workspaces" className="crm-workspace-tabs">
        {CRM_WORKSPACES.map((workspace) => (
          <button key={workspace} type="button" role="tab" id={`crm-tab-${workspace}`}
            aria-controls={`crm-panel-${workspace}`} aria-selected={active === workspace}
            tabIndex={active === workspace ? 0 : -1} onClick={() => onChange(workspace)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = nextCrmWorkspace(workspace, event.key);
              onChange(next);
              document.getElementById(`crm-tab-${next}`)?.focus();
            }}>
            <AfroGlyph variant={WORKSPACE_LABELS[workspace].glyph} aria-hidden="true" />
            {WORKSPACE_LABELS[workspace].label}
          </button>
        ))}
      </div>
    </section>
  );
}
