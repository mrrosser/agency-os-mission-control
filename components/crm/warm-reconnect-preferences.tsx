"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Fingerprint, LoaderCircle, ShieldCheck } from "lucide-react";
import type {
  WarmReconnectPreferenceResult,
  WarmReconnectTopics,
} from "@/lib/crm/warm-reconnect-preferences";

const EMPTY_TOPICS: WarmReconnectTopics = {
  marcus_rosser_art: false,
  rosser_gallery: false,
  rt_solutions: false,
};

const TOPIC_OPTIONS: Array<{
  id: keyof WarmReconnectTopics;
  name: string;
  description: string;
}> = [
  {
    id: "marcus_rosser_art",
    name: "Marcus Rosser — art and studio notes",
    description: "New work, process, exhibitions, and occasional personal updates.",
  },
  {
    id: "rosser_gallery",
    name: "Rosser Gallery",
    description: "Gallery exhibitions, artist news, events, and community invitations.",
  },
  {
    id: "rt_solutions",
    name: "RT.Solutions",
    description: "Practical technology, business systems, and useful project updates.",
  },
];

function fragmentToken(): string | null {
  const raw = window.location.hash.slice(1);
  const token = raw.startsWith("token=")
    ? new URLSearchParams(raw).get("token")
    : raw;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
}

async function postPreference(body: Record<string, unknown>): Promise<WarmReconnectPreferenceResult> {
  const response = await fetch("/api/crm/warm-reconnect/preferences", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as WarmReconnectPreferenceResult;
}

export function WarmReconnectPreferences() {
  const tokenRef = useRef<string | null>(null);
  const [result, setResult] = useState<WarmReconnectPreferenceResult | null>(null);
  const [topics, setTopics] = useState<WarmReconnectTopics>(EMPTY_TOPICS);
  const [busy, setBusy] = useState(true);
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    tokenRef.current ||= fragmentToken();
    const token = tokenRef.current;
    if (!token) {
      setBusy(false);
      return () => controller.abort();
    }

    void postPreference({ action: "inspect", token })
      .then((next) => {
        if (controller.signal.aborted) return;
        setResult(next);
        setTopics(next.topics || EMPTY_TOPICS);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function saveChoices() {
    const token = tokenRef.current;
    if (!token || !Object.values(topics).some(Boolean)) {
      setNotice("Choose at least one update, or use unsubscribe below.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const next = await postPreference({
        action: "save_preferences",
        token,
        requestId: crypto.randomUUID(),
        topics,
      });
      setResult(next);
      setTopics(next.topics || topics);
      setNotice(next.message);
    } catch {
      setNotice("We could not save that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    const token = tokenRef.current;
    if (!token) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await postPreference({ action: "unsubscribe", token });
      setResult(next);
      setTopics(EMPTY_TOPICS);
      setConfirmUnsubscribe(false);
      setNotice(next.message);
    } catch {
      setNotice("We could not process that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const available = result?.available === true;
  const globallyUnsubscribed = result?.globallyUnsubscribed === true;
  const canUpdate = result?.canUpdatePreferences === true;

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#0b0c0b] px-4 py-10 text-[#f5eddd] sm:px-6 sm:py-16"
      data-testid="warm-reconnect-preferences"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(191,151,83,0.14),transparent_28%),radial-gradient(circle_at_85%_70%,rgba(91,181,186,0.1),transparent_30%),linear-gradient(115deg,transparent_0_48%,rgba(255,255,255,0.025)_49%,transparent_50%)]"
      />
      <div className="relative mx-auto max-w-3xl">
        <header className="mb-8 border-b border-[#cda862]/25 pb-7">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#dfbe7b]">
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Marcus Rosser · Stay connected
          </div>
          <h1 className="mt-4 max-w-2xl font-serif text-4xl leading-[1.06] tracking-[-0.03em] text-[#fff7e7] sm:text-6xl">
            Your inbox should still feel like yours.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[#cfc4b1] sm:text-base">
            Choose the parts of Marcus&apos;s work you genuinely want to follow. Your choices apply to promotional email and can be changed later.
          </p>
        </header>

        {busy && !result ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-white/65">
            <LoaderCircle className="h-5 w-5 animate-spin text-[#dfbe7b]" aria-hidden="true" />
            Opening your private preference link…
          </div>
        ) : !available ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
            <ShieldCheck className="h-7 w-7 text-[#82c7c6]" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-2xl text-[#fff7e7]">This private link is not available.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#cfc4b1]">
              No contact information was shown or changed. If you received an email from Marcus, use the preference link in that message or reply directly for help.
            </p>
          </section>
        ) : globallyUnsubscribed ? (
          <section className="rounded-2xl border border-[#82c7c6]/30 bg-[#82c7c6]/[0.07] p-6 sm:p-8" role="status">
            <Check className="h-7 w-7 text-[#9bd9d6]" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-3xl text-[#fff7e7]">You&apos;re unsubscribed.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#d5ccbb]">
              Promotional email from this reconnect campaign is blocked. We&apos;ll keep that choice in place.
            </p>
          </section>
        ) : (
          <section aria-labelledby="choice-heading">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">Email preferences</p>
                <h2 id="choice-heading" className="mt-2 font-serif text-2xl text-[#fff7e7] sm:text-3xl">What would you like to hear about?</h2>
              </div>
              <span className="hidden text-xs text-white/35 sm:block">Nothing is selected for you.</span>
            </div>

            <div className="space-y-3">
              {TOPIC_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={`grid cursor-pointer grid-cols-[auto_1fr] gap-4 rounded-2xl border p-5 transition-colors ${
                    topics[option.id]
                      ? "border-[#dfbe7b]/55 bg-[#dfbe7b]/[0.09]"
                      : "border-white/10 bg-white/[0.035] hover:border-white/20"
                  } ${!canUpdate ? "cursor-not-allowed opacity-65" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={topics[option.id]}
                    disabled={!canUpdate || busy}
                    onChange={(event) =>
                      setTopics((current) => ({ ...current, [option.id]: event.target.checked }))
                    }
                    className="mt-1 h-5 w-5 accent-[#d7aa53]"
                  />
                  <span>
                    <span className="block font-medium text-[#fff7e7]">{option.name}</span>
                    <span className="mt-1 block text-sm leading-5 text-[#bdb3a2]">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>

            {result?.expired ? (
              <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-100/80">
                This link has expired, so it cannot add subscriptions. You can still unsubscribe below.
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 border-b border-white/10 pb-8 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={!canUpdate || busy}
                onClick={() => void saveChoices()}
                className="rounded-full bg-[#e0b760] px-6 py-3 text-sm font-semibold text-[#17130c] transition hover:bg-[#f0cc7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? "Saving…" : "Save my choices"}
              </button>
              <p className="text-xs leading-5 text-white/40">We don&apos;t sell your information or use this page for tracking.</p>
            </div>

            <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-5">
              <h3 className="font-medium text-[#fff7e7]">Prefer no promotional email?</h3>
              <p className="mt-2 text-sm leading-6 text-[#bdb3a2]">Unsubscribe globally from this reconnect campaign. This safety choice stays in place.</p>
              {!confirmUnsubscribe ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmUnsubscribe(true)}
                  className="mt-4 text-sm font-semibold text-[#e8c98b] underline decoration-[#e8c98b]/40 underline-offset-4 hover:decoration-[#e8c98b]"
                >
                  Unsubscribe from promotional email
                </button>
              ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void unsubscribe()}
                    className="rounded-full border border-red-300/40 bg-red-300/[0.08] px-5 py-2.5 text-sm font-semibold text-red-100"
                  >
                    Yes, unsubscribe me
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmUnsubscribe(false)}
                    className="rounded-full px-5 py-2.5 text-sm font-medium text-white/60"
                  >
                    Keep my current choices
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {notice ? (
          <p className="mt-5 rounded-xl border border-[#82c7c6]/25 bg-[#82c7c6]/[0.07] p-4 text-sm text-[#d9efed]" role="status">
            {notice}
          </p>
        ) : null}

        <footer className="mt-10 text-xs leading-5 text-white/35">
          This page intentionally shows no email address, contact name, tracking image, or remote media. Preference requests are processed over an encrypted connection.
        </footer>
      </div>
    </main>
  );
}
