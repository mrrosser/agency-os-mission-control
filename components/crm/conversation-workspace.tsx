"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import {
  ASSISTANT_API,
  type AssistantCapabilities,
  type AssistantCard,
  type AssistantChatResponse,
  type AssistantDestination,
  type AssistantMessage,
  type AssistantRequest,
  type AssistantToolResult,
} from "@/lib/crm/assistant/contracts";
import { createCrmVoiceController, type VoiceState } from "@/lib/crm/assistant/voice-client";
import { registerCrmSiteTools, supportsCrmSiteTools } from "@/lib/crm/assistant/webmcp";

type ConversationUser = { uid: string; getIdToken: () => Promise<string> };
type Props = {
  user: ConversationUser | null;
  active: boolean;
  onNavigate: (destination: AssistantDestination) => void;
};
type TranscriptEntry = AssistantMessage & { id: string; final: boolean; source: "text" | "voice" };
type ResultEntry = { key: string; card: AssistantCard };

const STARTERS = [
  { label: "People", text: "Show me what we know about our CRM community and what needs attention." },
  { label: "Outreach", text: "Help me review outreach readiness. Do not send or approve anything." },
  { label: "Share a card", text: "Show me our Gallery and RT Solutions contact cards and intake links." },
  { label: "Newsletter", text: "Help me draft a warm monthly gallery newsletter. Ask me for any event details you cannot verify." },
  { label: "Survey", text: "Help me draft a short community interest survey. This is a draft, not a published form." },
] as const;
const DESTINATIONS: Record<AssistantDestination, string> = {
  people: "Open People", outreach: "Open Outreach", share: "Open Share cards", activity: "Open Activity",
};
const VOICE_LABELS: Record<VoiceState, string> = {
  idle: "Microphone off", connecting: "Connecting voice…", listening: "Listening",
  thinking: "Thinking…", speaking: "Assistant speaking", muted: "Microphone muted",
};

function isDestination(value: unknown): value is AssistantDestination {
  return typeof value === "string" && Object.hasOwn(DESTINATIONS, value);
}
function safeRequestError(status?: number): string {
  if (status === 401) return "Your sign-in needs a refresh. Sign in again to continue.";
  if (status === 403) return "This Assistant action is not enabled for your account.";
  if (status === 429) return "The Assistant needs a short pause. Please try again in a moment.";
  if (status === 503) return "The Assistant is not configured or is temporarily unavailable. Your draft stays here.";
  if (status === 400 || status === 413) return "That request could not be accepted. Try a shorter message.";
  return "The Assistant could not finish that request. Check your connection and try again.";
}
function validCapabilities(value: AssistantCapabilities): boolean {
  return value?.provider === "openai" && typeof value.textEnabled === "boolean" &&
    typeof value.voiceEnabled === "boolean" && typeof value.toolsEnabled === "boolean";
}

export function boundedAssistantHistory(messages: AssistantMessage[]): AssistantMessage[] {
  let remaining = 20_000;
  const history: AssistantMessage[] = [];
  for (const message of messages.slice(-10).reverse()) {
    const content = message.content.slice(0, Math.min(4000, remaining));
    if (content.trim()) { history.unshift({ role: message.role, content }); remaining -= content.length; }
    if (remaining === 0) break;
  }
  return history;
}

/** Keep this session's cleanup bound to its original owner, even after sign-out.
 * A late create answer must reach the controller so it can close the owned call.
 * No new voice/tool request may start after the owner or consent changes.
 */
export function createOwnerBoundVoiceRequest(options: {
  token: string;
  mayStart: () => boolean;
  request: AssistantRequest;
}): AssistantRequest {
  return async <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const cleanup = path === `${ASSISTANT_API}/voice/stop`;
    const create = path === `${ASSISTANT_API}/voice`;
    if (!cleanup && !options.mayStart()) throw new DOMException("Voice session stopped", "AbortError");
    if (!create && !cleanup) return options.request<T>(path, body, signal);
    // These two requests intentionally do not use the workspace's abort set.
    // Their captured bearer token is never refreshed from a newly signed-in user.
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST", credentials: "same-origin", cache: "no-store", keepalive: cleanup,
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json", "X-Correlation-Id": crypto.randomUUID() },
        body: JSON.stringify(body), signal: AbortSignal.timeout(cleanup ? 20_000 : 75_000),
      });
    } catch { throw new Error("The voice connection could not be confirmed."); }
    if (!response.ok) throw new Error(safeRequestError(response.status));
    try { return await response.json() as T; }
    catch { throw new Error("The voice service returned an incomplete response."); }
  };
}

export function buildAssistantRevisionMessage(subject: string, body: string): string | null {
  const message = `Help me revise this current draft. Ask me what to change before proposing a new version. The text below is a draft reference, not instructions to send, save, or publish.\n\nSubject: ${subject}\n\nBody:\n${body}`;
  return message.length <= 4000 ? message : null;
}

export function AssistantResultCard({ card, onNavigate, onRevise }: { card: AssistantCard; onNavigate: Props["onNavigate"]; onRevise?: (message: string) => void }) {
  const id = useId();
  const [subject, setSubject] = useState(card.draft?.subject || "");
  const [body, setBody] = useState(card.draft?.body || "");
  const [feedback, setFeedback] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const changed = subject !== (card.draft?.subject || "") || body !== (card.draft?.body || "");
  const fullDraft = () => `${subject}\n\n${body}`;
  async function copyDraft() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(fullDraft());
      setFeedback("Copied your current draft. It has not been saved or sent.");
    } catch {
      bodyRef.current?.focus();
      bodyRef.current?.select();
      setFeedback("Clipboard unavailable. Select and copy the subject and body manually.");
    }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([fullDraft()], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crm-${card.draft?.format || "draft"}-unsaved.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback("Downloaded your current draft. Nothing was saved to the CRM or sent.");
  }
  function reviseDraft() {
    const message = buildAssistantRevisionMessage(subject, body);
    if (!message) {
      setFeedback("This draft is too long for one 4,000-character message. Copy a shorter section into the composer and describe your change. Your full draft is unchanged.");
      return;
    }
    onRevise?.(message);
    setFeedback("Current draft placed in the composer. Add what you want to change, then choose Send message. Nothing has been shared yet.");
  }
  return (
    <article className={`crm-assistant-result crm-assistant-result--${card.kind}`}>
      <div className="crm-assistant-result-heading">
        <AfroGlyph variant={card.draft ? "script" : card.kind === "navigation" ? "network" : "receipt"} aria-hidden="true" />
        <div><p className="crm-assistant-kicker">{card.draft ? "Draft for your review" : card.kind === "navigation" ? "Next step" : "Tool result"}</p><h3>{card.title}</h3></div>
      </div>
      <p className="crm-assistant-plain-text">{card.body}</p>
      {card.draft && (
        <div className="crm-assistant-draft">
          <p className="crm-assistant-unsaved">{changed ? "Edited locally · unsaved" : "Local proposal · unsaved"}. Not saved to CRM or Gmail. Not approved, published, or sent.</p>
          <label htmlFor={`${id}-subject`}>Subject or title</label>
          <input id={`${id}-subject`} value={subject} maxLength={500} onChange={(event) => { setSubject(event.target.value); setFeedback(""); }} />
          <label htmlFor={`${id}-body`}>Draft body</label>
          <textarea id={`${id}-body`} ref={bodyRef} value={body} rows={9} onChange={(event) => { setBody(event.target.value); setFeedback(""); }} />
          <p className="crm-assistant-small">Manual edits are not automatically shared back with the Assistant. {onRevise ? "Use Revise with Assistant to review a follow-up message before sending it." : "Copy your current draft into the composer when you want help revising it."}</p>
          <div className="crm-assistant-card-actions">
            {onRevise && <button type="button" onClick={reviseDraft}>Revise with Assistant</button>}
            <button type="button" onClick={() => void copyDraft()}>Copy current draft</button>
            <button type="button" onClick={downloadDraft}>Download .txt</button>
          </div>
          <p role="status" className="crm-assistant-small">{feedback}</p>
        </div>
      )}
      {isDestination(card.destination) && <button type="button" className="crm-assistant-next" onClick={() => onNavigate(card.destination!)}>{DESTINATIONS[card.destination]} <span aria-hidden="true">→</span></button>}
    </article>
  );
}

export function ConversationWorkspace({ user, active, onNavigate }: Props) {
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);
  const [capabilityError, setCapabilityError] = useState("");
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(true);
  const [consent, setConsent] = useState(false);
  const [composer, setComposer] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceNeedsCheck, setVoiceNeedsCheck] = useState(false);
  const [endingPreviousVoice, setEndingPreviousVoice] = useState(false);
  const [siteToolsSupported, setSiteToolsSupported] = useState(false);
  const [siteToolsEnabled, setSiteToolsEnabled] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef(user);
  const activeRef = useRef(active);
  const consentRef = useRef(consent);
  const onlineRef = useRef(online);
  const mountedRef = useRef(true);
  const requestsRef = useRef(new Set<AbortController>());
  const chatAbortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<ReturnType<typeof createCrmVoiceController> | null>(null);
  const voiceOwnerUidRef = useRef<string | null>(null);
  const voiceGenerationRef = useRef(0);
  const siteToolsCleanupRef = useRef<(() => void) | null>(null);
  userRef.current = user;
  activeRef.current = active;
  consentRef.current = consent;
  onlineRef.current = online;

  const request: AssistantRequest = useCallback(async <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (path !== ASSISTANT_API && !path.startsWith(`${ASSISTANT_API}/`)) throw new Error("Unsupported Assistant action.");
    if (path === `${ASSISTANT_API}/voice` || path === `${ASSISTANT_API}/voice/stop`) throw new Error("Voice requires its owner-bound session transport.");
    const currentUser = userRef.current;
    if (!currentUser || !activeRef.current) throw new Error("Open the Assistant while signed in to continue.");
    if (!onlineRef.current) throw new Error("You are offline. Reconnect to use the Assistant.");
    if (path !== ASSISTANT_API && !consentRef.current) throw new Error("Confirm the AI request notice before continuing.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    requestsRef.current.add(controller);
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const token = await currentUser.getIdToken();
      if (controller.signal.aborted || userRef.current?.uid !== currentUser.uid || !activeRef.current) throw new DOMException("Request stopped", "AbortError");
      let response: Response;
      try {
        response = await fetch(path, {
          method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, "X-Correlation-Id": crypto.randomUUID(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
      } catch (caught) {
        if (controller.signal.aborted) throw new DOMException("Request stopped", "AbortError");
        throw new Error(caught instanceof TypeError ? safeRequestError() : "The Assistant request could not be completed.");
      }
      if (!response.ok) throw new Error(safeRequestError(response.status));
      let value: T;
      try { value = await response.json() as T; }
      catch { throw new Error("The Assistant returned an incomplete response. Try again when your connection is ready."); }
      if (controller.signal.aborted || userRef.current?.uid !== currentUser.uid || !activeRef.current) throw new DOMException("Request stopped", "AbortError");
      return value;
    } finally {
      signal?.removeEventListener("abort", cancel);
      requestsRef.current.delete(controller);
    }
  }, []);

  const stopVoice = useCallback(() => {
    voiceGenerationRef.current += 1;
    const controller = voiceRef.current;
    voiceRef.current = null;
    const ownerUid = voiceOwnerUidRef.current;
    voiceOwnerUidRef.current = null;
    if (controller) {
      if (mountedRef.current) setVoiceNeedsCheck(true);
      void controller.stop().catch(() => {}).finally(() => {
        if (mountedRef.current && activeRef.current && userRef.current?.uid === ownerUid) setRetry((value) => value + 1);
      });
    }
    if (mountedRef.current) {
      setVoiceState("idle"); setMuted(false); setPlaybackBlocked(false);
    }
  }, []);
  const stopActivity = useCallback(() => {
    chatAbortRef.current?.abort();
    for (const controller of requestsRef.current) controller.abort();
    requestsRef.current.clear();
    stopVoice();
    siteToolsCleanupRef.current?.();
    siteToolsCleanupRef.current = null;
    if (mountedRef.current) { setBusy(false); setLoadingCapabilities(false); setSiteToolsEnabled(false); }
  }, [stopVoice]);
  const appendToolResult = useCallback((result: AssistantToolResult) => {
    if (!mountedRef.current || !activeRef.current || !userRef.current) return;
    if (Array.isArray(result.cards)) setResults((current) => [...current, ...result.cards.map((card) => ({ key: crypto.randomUUID(), card }))]);
    setNotice(result.summary || (result.ok ? "Tool result ready for review." : "That information is unavailable."));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setOnline(navigator.onLine);
    setVoiceSupported(window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof window.RTCPeerConnection === "function");
    setSiteToolsSupported(supportsCrmSiteTools());
    const updateOnline = () => { setOnline(navigator.onLine); if (!navigator.onLine) stopActivity(); };
    const visibility = () => {
      if (document.visibilityState === "hidden") { stopActivity(); setNotice("Paused while the page was in the background. Start voice again when you are ready."); }
      else if (activeRef.current) setRetry((value) => value + 1);
    };
    window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mountedRef.current = false;
      stopActivity();
      window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [stopActivity]);
  useEffect(() => {
    stopActivity();
    setTranscript([]); setResults([]); setComposer(""); setConsent(false); setCapabilities(null);
    setError(""); setNotice(""); setDevices([]); setDeviceId("");
    setVoiceNeedsCheck(false); setEndingPreviousVoice(false);
  }, [user?.uid, stopActivity]);
  useEffect(() => { if (!active) stopActivity(); }, [active, stopActivity]);
  useEffect(() => {
    if (!active || !userRef.current || !online) return;
    const controller = new AbortController();
    setLoadingCapabilities(true); setCapabilityError("");
    request<AssistantCapabilities>(ASSISTANT_API, undefined, controller.signal).then((value) => {
      if (!validCapabilities(value)) throw new Error("Assistant availability could not be verified.");
      setCapabilities(value);
      setVoiceNeedsCheck(false);
    }).catch((caught) => {
      if (!controller.signal.aborted) { setCapabilities(null); setCapabilityError(caught instanceof Error ? caught.message : "Assistant availability is unavailable."); }
    }).finally(() => { if (!controller.signal.aborted) setLoadingCapabilities(false); });
    return () => controller.abort();
  }, [active, user?.uid, online, retry, request]);

  async function sendMessage() {
    const text = composer.trim();
    if (!text || busy || !consent || !capabilities?.textEnabled || !online || !user || !active) return;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const entry: TranscriptEntry = { id: crypto.randomUUID(), role: "user", content: text, final: true, source: "text" };
    const history = boundedAssistantHistory([...transcript.filter((item) => item.final), entry]);
    setBusy(true); setError(""); setNotice(""); setTranscript((current) => [...current, entry]);
    try {
      const response = await request<AssistantChatResponse>(`${ASSISTANT_API}/chat`, { messages: history, requestId: crypto.randomUUID() }, controller.signal);
      if (response?.success !== true || typeof response.message !== "string" || !Array.isArray(response.cards)) throw new Error("The Assistant returned an incomplete response. Your text stays here.");
      setTranscript((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response.message, final: true, source: "text" }]);
      setResults((current) => [...current, ...response.cards.map((card) => ({ key: crypto.randomUUID(), card }))]);
      setComposer((current) => current.trim() === text ? "" : current);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : safeRequestError());
    } finally {
      if (chatAbortRef.current === controller) { chatAbortRef.current = null; setBusy(false); }
    }
  }
  async function startVoice() {
    if (!user || !active || !consent || !online || !capabilities?.voiceEnabled || !voiceSupported || voiceState !== "idle" || loadingCapabilities || voiceNeedsCheck || capabilities.voiceSession || capabilities.voiceSessionUnavailable) return;
    setError(""); setNotice(""); setPlaybackBlocked(false); setMuted(false); setVoiceState("connecting");
    const generation = ++voiceGenerationRef.current;
    const uid = user.uid;
    const valid = () => mountedRef.current && activeRef.current && consentRef.current && onlineRef.current && userRef.current?.uid === uid && voiceGenerationRef.current === generation;
    let token: string;
    try { token = await user.getIdToken(); }
    catch { if (valid()) { setError("Your sign-in needs a refresh before starting voice."); stopVoice(); } return; }
    if (!valid()) return;
    const voiceRequest = createOwnerBoundVoiceRequest({ token, mayStart: valid, request });
    const controller = createCrmVoiceController({
      request: voiceRequest,
      onState: (state) => {
        if (valid()) {
          setVoiceState(state);
          if (state === "idle") { setVoiceNeedsCheck(true); setRetry((value) => value + 1); }
        }
      },
      onTranscript: (entry) => {
        if (!valid()) return;
        const id = `voice-${generation}-${entry.id}`;
        setTranscript((current) => {
          const next: TranscriptEntry = { id, role: entry.role, content: entry.text, final: entry.final, source: "voice" };
          const index = current.findIndex((item) => item.id === id);
          return index < 0 ? [...current, next] : current.map((item) => item.id === id ? next : item);
        });
      },
      onToolResult: (result) => { if (valid()) appendToolResult(result); },
      onError: (message) => {
        if (mountedRef.current && userRef.current?.uid === uid) {
          setError(message); setVoiceNeedsCheck(true);
          if (activeRef.current) setRetry((value) => value + 1);
        }
      },
      onPlaybackBlocked: () => { if (valid()) setPlaybackBlocked(true); },
      onDevices: (items) => { if (valid()) setDevices(items); },
    });
    voiceOwnerUidRef.current = uid;
    voiceRef.current = controller;
    try { await controller.start(deviceId || undefined); }
    catch { if (valid()) { setError("Voice could not start. Check microphone permission, or keep typing below."); stopVoice(); } }
  }
  async function endPreviousVoice() {
    const owner = userRef.current;
    const session = capabilities?.voiceSession;
    if (!owner || !active || !online || !session?.canStop || endingPreviousVoice) return;
    setEndingPreviousVoice(true); setError("");
    try {
      const token = await owner.getIdToken();
      const cleanupRequest = createOwnerBoundVoiceRequest({ token, mayStart: () => false, request });
      await cleanupRequest(`${ASSISTANT_API}/voice/stop`, { sessionId: session.sessionId });
      if (mountedRef.current && userRef.current?.uid === owner.uid) {
        setNotice("Previous voice session ended. Checking the connection again…");
        setRetry((value) => value + 1);
      }
    } catch {
      if (mountedRef.current && userRef.current?.uid === owner.uid) setError("The previous voice session could not be confirmed ended. Keep voice off and check the connection before trying again.");
    } finally {
      if (mountedRef.current && userRef.current?.uid === owner.uid) setEndingPreviousVoice(false);
    }
  }
  async function refreshMicrophones() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const uid = userRef.current?.uid;
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
      if (activeRef.current && userRef.current?.uid === uid) setDevices(inputs.map((item, index) => ({ deviceId: item.deviceId, label: item.label || `Microphone ${index + 1}` })));
    } catch { setNotice("Microphone names may appear after you allow microphone access. You can still use the default microphone."); }
  }
  function toggleSiteTools(enabled: boolean) {
    if (!enabled) { siteToolsCleanupRef.current?.(); siteToolsCleanupRef.current = null; setSiteToolsEnabled(false); return; }
    if (!user || !active || !consent || !online || !capabilities?.toolsEnabled || !siteToolsSupported) return;
    const uid = user.uid;
    let registrationFailed = false;
    try {
      const cleanup = registerCrmSiteTools({
        request, onResult: appendToolResult,
        onError: (message) => {
          registrationFailed = true;
          siteToolsCleanupRef.current?.();
          siteToolsCleanupRef.current = null;
          if (mountedRef.current && userRef.current?.uid === uid) {
            setSiteToolsEnabled(false); setError(message);
          }
        },
      });
      if (registrationFailed) { cleanup(); return; }
      siteToolsCleanupRef.current = cleanup;
      setSiteToolsEnabled(true);
    } catch { setError("Site tools could not be enabled in this browser. Text chat still works independently."); }
  }
  const canRequest = Boolean(user && active && online && consent);
  const voiceActive = voiceState !== "idle";
  const availability = !user ? "Sign in to use the Assistant" : !online ? "Offline · drafts stay here" : loadingCapabilities ? "Checking availability…" : capabilityError ? "Connection unavailable" : capabilities?.textEnabled || capabilities?.voiceEnabled ? "Available on request" : "AI requests are not enabled";
  const voiceButtons = <div className="crm-assistant-voice-actions">
    {!voiceActive ? <button type="button" className="crm-assistant-primary" disabled={!canRequest || !capabilities?.voiceEnabled || !voiceSupported || loadingCapabilities || voiceNeedsCheck || Boolean(capabilities?.voiceSession) || capabilities?.voiceSessionUnavailable} onClick={() => void startVoice()}>Start voice</button> : <><button type="button" aria-pressed={muted} disabled={voiceState === "connecting"} onClick={() => { const next = !muted; voiceRef.current?.mute(next); setMuted(next); }}>{muted ? "Unmute microphone" : "Mute microphone"}</button><button type="button" onClick={stopVoice}>Stop voice</button></>}
  </div>;
  const playbackButton = playbackBlocked && <button type="button" className="crm-assistant-next" onClick={() => { void voiceRef.current?.resumePlayback().then(() => setPlaybackBlocked(false)).catch(() => setError("Audio playback is still blocked. Try again or continue with text.")); }}>Enable audio playback</button>;

  return (
    <section className="crm-assistant" aria-labelledby="crm-assistant-heading">
      <header className="crm-assistant-header">
        <div className="crm-assistant-emblem"><AfroGlyph variant="voice" aria-hidden="true" /></div>
        <div><p className="crm-assistant-kicker">Your CRM, in conversation</p><h2 id="crm-assistant-heading" tabIndex={-1}>What are we working on?</h2><p>Find your people. Shape a draft. Choose the next step.</p></div>
        <span className="crm-assistant-availability" role="status">{availability}</span>
      </header>
      <div className="crm-assistant-layout">
        <div className="crm-assistant-main">
          <div className="crm-assistant-consent">
            <label><input type="checkbox" checked={consent} disabled={!user} onChange={(event) => { setConsent(event.target.checked); if (!event.target.checked) stopActivity(); }} /><span>I understand AI requests send my text, microphone audio when voice is on, and needed CRM tool results to OpenAI.</span></label>
            <p>Only start with information you want to share. This conversation and edited drafts stay in this page&apos;s memory, not local storage. Copy or download what you want to keep.</p>
          </div>
          <section className="crm-assistant-mobile-voice" aria-label="Quick voice controls">
            <div className="crm-assistant-mobile-voice-heading"><AfroGlyph variant="voice" aria-hidden="true" /><div><p className="crm-assistant-kicker">Speak it through</p><p role="status">{VOICE_LABELS[voiceState]}</p></div></div>
            {voiceButtons}
            {playbackButton}
            <a href="#crm-assistant-voice-settings">{!voiceActive && (capabilities?.voiceSession || capabilities?.voiceSessionUnavailable || voiceNeedsCheck) ? "Voice needs attention · review connection" : "Microphone & connection settings"} <span aria-hidden="true">↓</span></a>
          </section>
          <div className="crm-assistant-starters" aria-label="Start a conversation">
            {STARTERS.map((starter) => <button key={starter.label} type="button" disabled={!user || busy} onClick={() => { setComposer(starter.text); composerRef.current?.focus(); }}>{starter.label}<span aria-hidden="true">＋</span></button>)}
          </div>
          <div className="crm-assistant-transcript" role="log" aria-label="Conversation transcript" aria-live="polite" aria-relevant="additions text">
            {transcript.length === 0 ? <div className="crm-assistant-empty"><AfroGlyph variant="chat" aria-hidden="true" /><h3>A thought is enough to start.</h3><p>Ask about CRM evidence or work through a draft. Nothing here automatically saves contacts, enrolls people, publishes forms, or sends email.</p></div> : transcript.map((entry) => <article key={entry.id} className={`crm-assistant-message crm-assistant-message--${entry.role}`}><p className="crm-assistant-kicker">{entry.role === "user" ? "You" : "CRM Assistant"}{entry.source === "voice" ? " · voice" : ""}{!entry.final ? " · in progress" : ""}</p><p className="crm-assistant-plain-text">{entry.content}</p></article>)}
            {busy && <p className="crm-assistant-working" role="status">Working on your request…</p>}
          </div>
          {error && <p className="crm-assistant-error" role="alert">{error}</p>}
          {notice && <p className="crm-assistant-notice" role="status">{notice}</p>}
          <form className="crm-assistant-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label htmlFor="crm-assistant-message">Message the CRM Assistant</label>
            <textarea ref={composerRef} id="crm-assistant-message" rows={3} maxLength={4000} value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="Help me put together this month’s gallery newsletter…" disabled={!user} aria-describedby="crm-assistant-composer-help" />
            <div className="crm-assistant-composer-actions"><p id="crm-assistant-composer-help">Enter adds a line. Send only when you&apos;re ready.</p>{busy ? <button type="button" onClick={() => { chatAbortRef.current?.abort(); setBusy(false); setNotice("Request stopped. Your text stays in the composer."); }}>Stop request</button> : <button type="submit" className="crm-assistant-primary" disabled={!canRequest || !capabilities?.textEnabled || !composer.trim()}>Send message <span aria-hidden="true">↗</span></button>}</div>
          </form>
          <div className="crm-assistant-unavailable"><p>{capabilityError || (capabilities && !capabilities.textEnabled && !capabilities.voiceEnabled ? "AI access has not been enabled. You can still use every existing CRM workspace and write in the composer." : "Availability checks inspect connection status, not provider credentials. No AI request is started.")}</p><button type="button" disabled={!user || !online || loadingCapabilities} onClick={() => setRetry((value) => value + 1)}>Check availability again</button></div>
        </div>
        <aside className="crm-assistant-side" aria-label="Voice and site tools">
          <section className="crm-assistant-voice" id="crm-assistant-voice-settings" tabIndex={-1}>
            <div className={`crm-assistant-voice-mark ${voiceActive ? "is-active" : ""}`}><AfroGlyph variant="voice" aria-hidden="true" /></div>
            <h3>Speak it through.</h3><p>Voice starts only when you choose it.</p>
            <p className="crm-assistant-voice-state crm-assistant-desktop-voice-controls" role="status">{VOICE_LABELS[voiceState]}</p>
            {capabilities?.voiceSession && !voiceActive && <div className="crm-assistant-voice-recovery" role="status"><strong>Previous voice session needs attention</strong><p>{capabilities.voiceSession.canStop ? "End the previous session before starting another. Ending it does not start an AI request." : "The previous call cannot be confirmed yet. It needs reconciliation before you can start another session."}</p>{capabilities.voiceSession.canStop && <button type="button" disabled={!user || !online || endingPreviousVoice} onClick={() => void endPreviousVoice()}>{endingPreviousVoice ? "Ending previous session…" : "End previous voice session"}</button>}</div>}
            {capabilities?.voiceSessionUnavailable && <p className="crm-assistant-small" role="status">Voice session status is unavailable. Check availability before starting voice.</p>}
            <label htmlFor="crm-assistant-microphone">Microphone</label>
            <select id="crm-assistant-microphone" value={deviceId} disabled={voiceActive || !voiceSupported} onChange={(event) => setDeviceId(event.target.value)}><option value="">Default microphone</option>{devices.filter((item) => item.deviceId).map((item, index) => <option key={`${item.deviceId}-${index}`} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select>
            <button type="button" className="crm-assistant-subtle" disabled={!voiceSupported || voiceActive || !user} onClick={() => void refreshMicrophones()}>Refresh microphones</button>
            <div className="crm-assistant-desktop-voice-controls">{voiceButtons}{playbackButton}</div>
            <p className="crm-assistant-small">{!voiceSupported ? "Voice is unavailable in this browser. Text chat is independent of microphone access." : !capabilities?.voiceEnabled ? "Voice is not enabled on this server yet." : "Leaving this workspace, hiding this page, or signing out stops voice. Sessions have a local five-minute limit. Earlier typed messages are not automatically forwarded into a new voice session."}</p>
          </section>
          <section className="crm-assistant-tools"><h3>Browser site tools</h3><p>Optional access for a compatible browser assistant. The same bounded CRM tools, with no send or approval actions.</p><label><input type="checkbox" checked={siteToolsEnabled} disabled={!canRequest || !capabilities?.toolsEnabled || !siteToolsSupported} onChange={(event) => toggleSiteTools(event.target.checked)} /><span>{siteToolsEnabled ? "Site tools active · uncheck to disable" : "Enable site tools for this session"}</span></label>{!siteToolsSupported && <p className="crm-assistant-small">This browser does not expose WebMCP. You can still use text and supported voice.</p>}</section>
          <p className="crm-assistant-scope-note">Inbox analytics and survey response collection are not connected in this workspace. Survey copy is an editable proposal only.</p>
          <button type="button" className="crm-assistant-clear" disabled={transcript.length === 0 && results.length === 0} onClick={() => { if (window.confirm("Clear this conversation and its unsaved drafts? Download anything you want to keep first.")) { stopActivity(); setTranscript([]); setResults([]); setNotice("Conversation cleared from this page."); } }}>Clear conversation &amp; unsaved drafts</button>
        </aside>
      </div>
      {results.length > 0 && <section className="crm-assistant-results" aria-labelledby="crm-assistant-results-heading"><div className="crm-assistant-results-heading"><p className="crm-assistant-kicker">Evidence &amp; next steps</p><h2 id="crm-assistant-results-heading">Ready for your review.</h2><p>Read the result. Edit the proposal. You choose what happens next.</p></div><div className="crm-assistant-result-grid">{results.map(({ key, card }) => <AssistantResultCard key={key} card={card} onNavigate={onNavigate} onRevise={(message) => { setComposer(message); composerRef.current?.focus({ preventScroll: true }); composerRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); }} />)}</div></section>}
    </section>
  );
}
