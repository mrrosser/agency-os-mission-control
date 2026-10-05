"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders } from "@/lib/api/client";
import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID, WARM_RECONNECT_QA_REVISED_TEST_ID, warmReconnectQaVersion, type WarmReconnectQaTestId } from "@/lib/crm/warm-reconnect-qa-version";

type Review = {
  testMode: true;
  status: "blocked" | "not_prepared" | "prepared" | "provider_inflight" | "sent" | "delivery_unknown";
  testId: WarmReconnectQaTestId;
  designVersion: string;
  designReady?: boolean;
  blockedReason?: string;
  artifactFingerprint?: string;
  recipient?: string;
  from?: string;
  subject?: string;
  plainText?: string;
  html?: string;
  previewHtml?: string;
  providerMessageId?: string | null;
  qaPreferenceState?: { topics: { rosser_gallery: boolean; rt_solutions: boolean }; globallyUnsubscribed: boolean; confirmations: number } | null;
};

export function WarmReconnectOwnerTest() {
  return <div data-testid="warm-reconnect-owner-test">
    <OwnerTestPanel testId={WARM_RECONNECT_QA_REVISED_TEST_ID} />
    <details className="mb-6 rounded-xl border border-white/15 p-4">
      <summary className="cursor-pointer text-sm text-zinc-300">Original October 4 test receipt (read only)</summary>
      <OwnerTestPanel testId={WARM_RECONNECT_QA_ORIGINAL_TEST_ID} />
    </details>
  </div>;
}

function OwnerTestPanel({ testId }: { testId: WarmReconnectQaTestId }) {
  const version = warmReconnectQaVersion(testId);
  const original = testId === WARM_RECONNECT_QA_ORIGINAL_TEST_ID;
  const endpoint = original ? "/api/crm/warm-reconnect/qa" : "/api/crm/warm-reconnect/qa/revised";
  const { user } = useAuth();
  const ownerRef = useRef<string | null>(null);
  const ownerEpoch = useRef(0);
  if (ownerRef.current !== (user?.uid || null)) ownerEpoch.current += 1;
  ownerRef.current = user?.uid || null;
  const [saved, setSaved] = useState<{ uid: string; review: Review } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sendAttemptOwner, setSendAttemptOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const review = saved?.uid === user?.uid ? saved?.review : null;
  const attempted = Boolean(user && sendAttemptOwner === user.uid);
  useEffect(() => {
    setSaved(null);
    setPending(false);
    setConfirmed(false);
    setSendAttemptOwner(null);
    setError(null);
    setRecipientInput("");
  }, [user?.uid]);

  async function request(action: "prepare" | "refresh" | "send") {
    if (!user || pending) return;
    const uid = user.uid;
    const epoch = ownerEpoch.current;
    const currentOwner = () => ownerRef.current === uid && ownerEpoch.current === epoch;
    if (original && action !== "refresh") return;
    if (action === "prepare" && (!recipientInput.trim() || review?.status !== "not_prepared" || review.designReady !== true)) return;
    if (action === "send" && (!confirmed || attempted || !exactReview || !review?.recipient || !review.artifactFingerprint)) return;
    if (action === "send") setSendAttemptOwner(uid);
    setPending(true);
    setError(null);
    try {
      const headers = await buildAuthHeaders(user);
      if (!currentOwner()) return;
      const response = await fetch(`${endpoint}/${action === "send" ? "send" : "prepare"}`, {
        method: action === "refresh" ? "GET" : "POST", headers, cache: "no-store",
        signal: AbortSignal.timeout(45_000),
        ...(action === "refresh" ? {} : { body: JSON.stringify(action === "prepare"
          ? { recipient: recipientInput.trim(), testOnly: true }
          : { recipient: review!.recipient, artifactFingerprint: review!.artifactFingerprint, confirmSendOneTest: true,
            reviewedTestId: testId, reviewedDesignVersion: version.designVersion }) }),
      });
      const result = await response.json() as Review;
      if (!currentOwner()) return;
      if (!response.ok || result.testMode !== true || result.testId !== testId || result.designVersion !== version.designVersion ||
          !["blocked", "not_prepared", "prepared", "provider_inflight", "sent", "delivery_unknown"].includes(result.status)) {
        throw new Error("Test unavailable");
      }
      setSaved({ uid, review: action === "send" && review ? { ...review, ...result } : result });
      setConfirmed(false);
    } catch {
      if (currentOwner()) setError(action === "send"
        ? "The send result is uncertain. Refresh the receipt. Do not send another test."
        : "This test version could not be loaded. Check your CRM sign-in and refresh this version's receipt.");
    } finally {
      if (currentOwner()) setPending(false);
    }
  }

  const exactReview = !original && review?.status === "prepared" && review.testId === testId && review.designVersion === version.designVersion &&
    review.designReady === true && typeof review.recipient === "string" && review.recipient.length > 0 &&
    review.from === "mrosser@rossergallery.com" && review.subject === version.subject &&
    typeof review.plainText === "string" && typeof review.html === "string" && /^sha256:[a-f0-9]{64}$/.test(review.artifactFingerprint || "");

  return <section className="mb-6 rounded-xl border border-amber-200/25 bg-amber-200/[0.04] p-5" aria-labelledby={`owner-test-heading-${testId}`} data-testid={original ? "owner-test-original" : "owner-test-revised"}>
    <h2 id={`owner-test-heading-${testId}`} className="font-semibold text-amber-100">{version.label}</h2>
    <p className="mt-2 text-sm text-zinc-300">{original ? "The original test and its delivery receipt are preserved. This panel cannot resend it." : "One separately authorized revised email, from mrosser@rossergallery.com to your authorized test inbox. This checks the design and buttons without subscribing contacts or sending the five-person campaign."}</p>
    <p className="mt-2 break-all text-xs text-zinc-400">Test identity: {testId}<br />Design version: {version.designVersion}</p>
    {!original && !review && <p className="mt-3 text-sm text-zinc-300">Refresh this version to check whether the exact design is ready for review.</p>}
    {!original && review?.status === "not_prepared" && review.designReady === true && <label className="mt-4 block text-sm text-zinc-300">Approved revised-test inbox<input type="email" autoComplete="off" value={recipientInput} disabled={!user || pending || attempted} onChange={event => setRecipientInput(event.target.value)} className="mt-1 block w-full max-w-md rounded-md border border-white/20 bg-black/20 px-3 py-2" /></label>}
    <div className="mt-4 flex flex-wrap gap-3">
      {!original && <button type="button" disabled={!user || pending || attempted || !recipientInput.trim() || review?.status !== "not_prepared" || review.designReady !== true} onClick={() => void request("prepare")} className="rounded-md border border-white/20 px-4 py-2 text-sm disabled:opacity-40">Prepare revised private test</button>}
      <button type="button" disabled={!user || pending} onClick={() => void request("refresh")} className="rounded-md border border-white/20 px-4 py-2 text-sm disabled:opacity-40">{original ? "Refresh original receipt" : "Refresh revised test"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-amber-100">{error}</p>}
    {review && <div className="mt-4 text-sm">
      <p role="status">{review.status === "blocked" || (!original && review.designReady === false) ? "The exact revised design kit is not integrated. Preparation and sending are disabled." : review.status === "sent" ? "This version was sent. Use its Gmail message to try the choices." : review.status === "provider_inflight" || review.status === "delivery_unknown" ? "Delivery is uncertain. Sending is locked; check the existing message and receipt." : review.status === "prepared" ? "This version is prepared. Review the exact recipient, design and email below." : "This version has not been prepared."}</p>
      {review.providerMessageId && <p className="mt-2 break-all text-xs text-zinc-400">Delivery receipt: {review.providerMessageId}</p>}
      {exactReview && <>
        <p className="mt-3">To: {review.recipient}<br />From: {review.from}<br />Subject: {review.subject}</p>
        <p className="mt-2 break-all text-xs text-zinc-400">Reviewed artifact: {review.artifactFingerprint}</p>
        <iframe title="Private revised test email preview" sandbox="" referrerPolicy="no-referrer" className="mt-3 h-[680px] w-full rounded bg-white" srcDoc={(review.previewHtml || review.html!).replace(/\shref=(?:"[^"]*"|'[^']*')/gi, "")} />
        <details className="mt-2"><summary>Plain-text version</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{review.plainText}</pre></details>
        <p className="mt-2 text-xs text-zinc-400">Preview links are inactive. The delivered test has private working links.</p>
        <label className="mt-4 flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending || attempted} onChange={event => setConfirmed(event.target.checked)} />I reviewed design {version.designVersion} for this one revised test to {review.recipient}.</label>
        <button type="button" disabled={pending || attempted || !confirmed} onClick={() => void request("send")} className="mt-3 rounded-md bg-amber-200 px-4 py-2 font-medium text-black disabled:opacity-40">Send one revised test</button>
      </>}
      {review.qaPreferenceState && <p className="mt-3 text-zinc-300">Test choices: {review.qaPreferenceState.globallyUnsubscribed ? "test unsubscribe recorded" : [review.qaPreferenceState.topics.rosser_gallery && "Rosser Gallery", review.qaPreferenceState.topics.rt_solutions && "RT.Solutions"].filter(Boolean).join(" and ") || "none confirmed"}. Real newsletter subscriptions are unchanged.</p>}
    </div>}
  </section>;
}
