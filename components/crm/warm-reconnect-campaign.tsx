import {
  CheckCircle2,
  Fingerprint,
  Image as ImageIcon,
  LockKeyhole,
  Mail,
  ShieldAlert,
} from "lucide-react";
import type { WarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect-types";

type Props = {
  campaign: WarmReconnectCampaignDraft | null;
  loading: boolean;
  error: string | null;
};

function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function WarmReconnectCampaign({ campaign, loading, error }: Props) {
  if (loading) {
    return (
      <section
        aria-labelledby="warm-reconnect-heading"
        className="mb-6 overflow-hidden rounded-2xl border border-amber-300/20 bg-[#100f0d] p-4 sm:p-6"
        data-testid="warm-reconnect-campaign"
      >
        <h2 id="warm-reconnect-heading" className="text-sm font-medium text-amber-50/60">
          Building the read-only campaign preview…
        </h2>
      </section>
    );
  }

  if (error || !campaign) {
    return (
      <section
        aria-labelledby="warm-reconnect-heading"
        className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 sm:p-6"
        data-testid="warm-reconnect-campaign"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
          <div>
            <h2 id="warm-reconnect-heading" className="font-semibold text-red-100">
              Reconnect preview unavailable — campaign remains blocked
            </h2>
            <p className="mt-1 break-words text-sm text-red-100/70">
              {error || "The aggregate-only review contract was not returned."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="warm-reconnect-heading"
      className="relative mb-6 overflow-hidden rounded-2xl border border-amber-300/20 bg-[#100f0d] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      data-testid="warm-reconnect-campaign"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-cyan-300/10 shadow-[inset_0_0_0_18px_rgba(103,232,249,0.025),inset_0_0_0_42px_rgba(251,191,36,0.02)]"
      />

      <div className="relative border-b border-white/10 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
              <Fingerprint className="h-4 w-4" aria-hidden="true" />
              Warm reconnect · concept review
            </div>
            <h2 id="warm-reconnect-heading" className="mt-3 text-2xl font-semibold tracking-tight text-[#fff8e8] sm:text-3xl">
              A thoughtful way back into the conversation
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d8d0bd]">
              Review Marcus&apos;s voice, artwork, audience posture, and every missing safety gate before a future pilot.
            </p>
          </div>
          <div className="w-fit rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100">
            No contacts selected · nothing drafted or sent
          </div>
        </div>
      </div>

      <div className="relative grid gap-4 p-4 sm:p-6 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">People</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{number(campaign.audience.people)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">Unassigned people</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-200">{number(campaign.audience.unassignedPeople)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">Email contact points</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{number(campaign.audience.emailContactPoints)}</p>
            </div>
            <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-red-100/55">Eligible recipients</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-red-200">0</p>
            </div>
          </div>

          <div className="rounded-xl border border-red-400/25 bg-red-400/[0.06] p-4">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-red-200" aria-hidden="true" />
              <div>
                <p className="font-semibold text-red-100">Activation blocked</p>
                <p className="mt-1 text-xs leading-5 text-red-100/65">
                  The {number(campaign.audience.emailContactPoints)} email entries are contact points, not a deduplicated or permission-cleared audience. SMS, calls, social matching, exports, provider drafts, and sends stay disabled.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Before a future 5–10 person pilot</p>
            <ul className="mt-3 space-y-2">
              {campaign.activation.gates.map((gate) => (
                <li key={gate.id} className="flex items-start gap-2 text-xs leading-5 text-[#d8d0bd]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
                  <span><strong className="font-medium text-[#fff8e8]">{gate.label}:</strong> {gate.requirement}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-col gap-1 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email concept · 640px preview</span>
            <span>Subject: {campaign.copy.subject}</span>
          </div>

          <div className="relative mx-auto max-w-[640px] overflow-hidden rounded-[26px] border border-[#d8b46a]/30 bg-[#f4ecdb] text-[#171512] shadow-2xl">
            {/* The bundled, content-addressed asset is decorative and optimized at 1280px. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={campaign.artwork.url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-[0.16] grayscale"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#101617]/95 via-[#171510]/90 to-[#10100e]/95" aria-hidden="true" />
            <div className="relative p-5 sm:p-8">
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Marcus Rosser · New Orleans</p>
                <Fingerprint className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
              </div>
              <p className="mt-6 text-xs italic leading-5 text-white/55">{campaign.copy.preheader}</p>
              <h3 className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight text-[#fff8e8] sm:text-4xl">
                {campaign.copy.subject}
              </h3>
              <div className="mt-6 space-y-4 text-sm leading-6 text-[#eee5d2] sm:text-[15px]">
                <p>{campaign.copy.greeting}</p>
                {campaign.copy.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <button
                type="button"
                disabled
                className="mt-6 w-full cursor-not-allowed rounded-full border border-dashed border-cyan-200/45 bg-cyan-200/10 px-5 py-3 text-sm font-semibold text-cyan-100/70 sm:w-auto"
              >
                {campaign.primaryCta.label} · preference link required
              </button>
              <div className="mt-6 space-y-4 text-sm leading-6 text-[#eee5d2] sm:text-[15px]">
                {campaign.copy.postCtaParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                <p>{campaign.copy.signature.map((line) => <span key={line} className="block">{line}</span>)}</p>
              </div>
              <div className="mt-7 border-t border-white/15 pt-4 text-[11px] leading-5 text-white/45">
                <p>Promotional email concept. Verified postal address and working unsubscribe/preferences link are required before activation.</p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-white"><ImageIcon className="h-4 w-4 text-amber-200" aria-hidden="true" /> Artwork evidence</p>
              <p className="mt-2 text-xs leading-5 text-white/55">{campaign.artwork.alt}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-amber-200">Preview cleared · email-channel approval still required</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-white"><CheckCircle2 className="h-4 w-4 text-cyan-200" aria-hidden="true" /> Integrity receipt</p>
              <p className="mt-2 break-all font-mono text-[10px] leading-4 text-white/55">{campaign.review.previewFingerprint}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-white/40">Preview integrity only · zero send authority</p>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-white">Plain-text fallback</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-white/60">{campaign.copy.plainText}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}
