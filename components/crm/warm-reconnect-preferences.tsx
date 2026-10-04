"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Fingerprint, LoaderCircle, ShieldCheck } from "lucide-react";
import type {
  WarmReconnectPreferenceResult,
  WarmReconnectTopics,
} from "@/lib/crm/warm-reconnect-preferences";
import {
  parseWarmReconnectPreferenceFragment,
  isWarmReconnectQaFragment,
  warmReconnectChoiceTopics,
  type WarmReconnectChoice,
} from "@/lib/crm/warm-reconnect-preference-choice";

const EMPTY_TOPICS: WarmReconnectTopics = {
  rosser_gallery: false,
  rt_solutions: false,
};

const TOPIC_OPTIONS: Array<{
  id: keyof WarmReconnectTopics;
  name: string;
  description: string;
}> = [
  {
    id: "rosser_gallery",
    name: "Rosser Gallery",
    description: "Art, exhibitions, workshops, newsletters, and community events.",
  },
  {
    id: "rt_solutions",
    name: "RT.Solutions",
    description: "Practical technology, business systems, project news, and events.",
  },
];

function businessTopics(value?: Partial<WarmReconnectTopics>): WarmReconnectTopics {
  return {
    rosser_gallery: value?.rosser_gallery === true,
    rt_solutions: value?.rt_solutions === true,
  };
}

function fragmentSelection() {
  const fragment = window.location.hash.slice(1);
  const selection = { ...parseWarmReconnectPreferenceFragment(fragment), ownerQa: isWarmReconnectQaFragment(fragment) };
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return selection;
}

type PreferenceResult = WarmReconnectPreferenceResult & { testMode?: boolean; confirmationNonce?: string };

async function postPreference(body: Record<string, unknown>, ownerQa = false): Promise<PreferenceResult> {
  const response = await fetch(ownerQa ? "/api/crm/warm-reconnect/qa/preferences" : "/api/crm/warm-reconnect/preferences", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as PreferenceResult;
}

export function WarmReconnectPreferences() {
  const tokenRef = useRef<string | null>(null);
  const choiceRef = useRef<WarmReconnectChoice | null>(null);
  const qaRef = useRef(false);
  const [result, setResult] = useState<PreferenceResult | null>(null);
  const [topics, setTopics] = useState<WarmReconnectTopics>(EMPTY_TOPICS);
  const [busy, setBusy] = useState(true);
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!tokenRef.current) {
      const selection = fragmentSelection();
      tokenRef.current = selection.token;
      choiceRef.current = selection.choice;
      qaRef.current = selection.ownerQa;
    }
    const token = tokenRef.current;
    if (!token) {
      setBusy(false);
      return () => controller.abort();
    }

    void postPreference({ action: "inspect", token }, qaRef.current)
      .then((next) => {
        if (controller.signal.aborted) return;
        setResult(next);
        // A fragment choice only changes the visible selection. Never save on load.
        setTopics(next.canUpdatePreferences && !next.globallyUnsubscribed && choiceRef.current
          ? warmReconnectChoiceTopics(choiceRef.current)
          : businessTopics(next.topics));
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
        ...(qaRef.current ? { confirmationNonce: result?.confirmationNonce } : {}),
      }, qaRef.current);
      setResult(next);
      setTopics(businessTopics(next.topics || topics));
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
      const next = await postPreference({ action: "unsubscribe", token,
        ...(qaRef.current ? { confirmationNonce: result?.confirmationNonce, requestId: crypto.randomUUID() } : {}),
      }, qaRef.current);
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
  const qaReady = !qaRef.current || (result?.testMode === true && Boolean(result?.confirmationNonce));
  const canUpdate = result?.canUpdatePreferences === true && qaReady;

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
        {qaRef.current && <p role="note" className="mb-6 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-amber-100">
          TEST: Your choices apply only to this private test. They do not subscribe you to newsletters or change campaign contacts.
        </p>}
        <header className="mb-8 border-b border-[#cda862]/25 pb-7">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#dfbe7b]">
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Marcus Rosser · Stay connected
          </div>
          <h1 className="mt-4 max-w-2xl font-serif text-4xl leading-[1.06] tracking-[-0.03em] text-[#fff7e7] sm:text-6xl">
            Your inbox should still feel like yours.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[#cfc4b1] sm:text-base">
            {qaRef.current
              ? "Try Rosser Gallery, RT.Solutions, or both. Your choices are recorded only for this test."
              : "Choose updates from Rosser Gallery, RT.Solutions, or both. Your choices apply to promotional email and can be changed later."}
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
            <h2 className="mt-5 font-serif text-3xl text-[#fff7e7]">{qaRef.current ? "Test unsubscribe saved." : "You're unsubscribed."}</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#d5ccbb]">
              {qaRef.current
                ? "Your test choices are cleared. Real newsletter subscriptions and campaign contacts are unchanged."
                : "Promotional email from this reconnect campaign is blocked. We'll keep that choice in place."}
            </p>
          </section>
        ) : (
          <section aria-labelledby="choice-heading">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">Email preferences</p>
                <h2 id="choice-heading" className="mt-2 font-serif text-2xl text-[#fff7e7] sm:text-3xl">What would you like to hear about?</h2>
              </div>
              <span className="text-xs text-white/50">Nothing changes until you confirm.</span>
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
                {qaRef.current
                  ? "This test link has expired, so it cannot save new test choices. You can still test unsubscribe below."
                  : "This link has expired, so it cannot add subscriptions. You can still unsubscribe below."}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 border-b border-white/10 pb-8 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={!canUpdate || busy}
                onClick={() => void saveChoices()}
                className="rounded-full bg-[#e0b760] px-6 py-3 text-sm font-semibold text-[#17130c] transition hover:bg-[#f0cc7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? "Saving…" : "Confirm my updates"}
              </button>
              <p className="text-xs leading-5 text-white/40">We don&apos;t sell your information or use this page for tracking.</p>
            </div>

            <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-5">
              <h3 className="font-medium text-[#fff7e7]">Prefer no promotional email?</h3>
              <p className="mt-2 text-sm leading-6 text-[#bdb3a2]">{qaRef.current
                ? "Test the unsubscribe control. It clears this test's choices only and leaves real subscriptions unchanged."
                : "Unsubscribe globally from this reconnect campaign. This safety choice stays in place."}</p>
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
