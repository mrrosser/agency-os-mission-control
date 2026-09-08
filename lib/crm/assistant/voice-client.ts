import { ASSISTANT_API, VOICE_MAX_SECONDS, type AssistantRequest, type AssistantToolResult } from "./contracts";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted";
export type VoiceTranscript = { id: string; role: "user" | "assistant"; text: string; final: boolean };
type Options = {
  request: AssistantRequest;
  onState: (state: VoiceState) => void;
  onTranscript: (entry: VoiceTranscript) => void;
  onToolResult: (result: AssistantToolResult) => void;
  onError: (message: string) => void;
  onPlaybackBlocked: () => void;
  onDevices: (devices: { deviceId: string; label: string }[]) => void;
};
type VoiceAnswer = { sdp: string; sessionId: string; maxSeconds: number };
type EventItem = { id?: string; type?: string; name?: string; arguments?: string; call_id?: string };
type RealtimeEvent = {
  type?: string; item_id?: string; transcript?: string; text?: string;
  response?: { id?: string; status?: string; output?: EventItem[] };
};

/** Explicit-start browser transport. All CRM tool authority remains in the authenticated server gateway. */
export function createCrmVoiceController(options: Options) {
  let generation = 0;
  let state: VoiceState = "idle";
  let muted = false;
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let media: MediaStream | undefined;
  let audio: HTMLAudioElement | undefined;
  let sessionId: string | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let connectionDeadline: ReturnType<typeof setTimeout> | undefined;
  let toolAbort: AbortController | undefined;
  let removeLifecycle: (() => void) | undefined;

  function setState(next: VoiceState) {
    state = next;
    options.onState(next);
  }
  const resting = () => setState(muted ? "muted" : "listening");
  async function hangup(id: string) {
    try {
      await options.request(`${ASSISTANT_API}/voice/stop`, { sessionId: id });
    } catch {
      options.onError("Your microphone is off. The server could not confirm the call ended; check your connection before starting again.");
    }
  }
  async function stop() {
    generation += 1;
    clearTimeout(deadline);
    clearTimeout(connectionDeadline);
    toolAbort?.abort();
    toolAbort = undefined;
    removeLifecycle?.();
    removeLifecycle = undefined;
    if (channel) {
      channel.onopen = null; channel.onmessage = null; channel.onerror = null; channel.onclose = null;
      channel.close();
      channel = undefined;
    }
    if (peer) {
      peer.ontrack = null; peer.onconnectionstatechange = null;
      peer.close();
      peer = undefined;
    }
    media?.getTracks().forEach((track) => track.stop());
    media = undefined;
    if (audio) {
      audio.pause(); audio.srcObject = null; audio.remove();
      audio = undefined;
    }
    const ended = sessionId;
    sessionId = undefined;
    muted = false;
    setState("idle");
    if (ended) await hangup(ended);
  }
  async function start(deviceId?: string) {
    if (state !== "idle") return;
    const current = ++generation;
    const isCurrent = () => current === generation;
    const callIds = new Set<string>();
    const responseIds = new Set<string>();
    let speechVersion = 0;
    let toolCount = 0;
    let work = Promise.resolve();
    setState("connecting");
    if (typeof window === "undefined" || !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setState("idle");
      options.onError("Voice needs a supported browser on HTTPS with microphone access. You can keep using typed chat.");
      return;
    }
    const handleBackground = () => {
      if (document.visibilityState === "hidden") void stop();
    };
    const handlePageHide = () => { void stop(); };
    document.addEventListener("visibilitychange", handleBackground);
    window.addEventListener("pagehide", handlePageHide);
    removeLifecycle = () => {
      document.removeEventListener("visibilitychange", handleBackground);
      window.removeEventListener("pagehide", handlePageHide);
    };
    connectionDeadline = setTimeout(() => {
      if (!isCurrent()) return;
      options.onError("Voice took too long to connect. Your microphone has been released; try again or type below.");
      void stop();
    }, 30_000);
    try {
      // Permission is deliberately inside the user-triggered start call, never page initialization.
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      } });
      if (!isCurrent()) { acquired.getTracks().forEach((track) => track.stop()); return; }
      media = acquired;
      for (const track of acquired.getAudioTracks()) {
        track.onended = () => {
          if (!isCurrent()) return;
          options.onError("The microphone disconnected. You can choose another microphone or continue by typing.");
          void stop();
        };
      }
      // Device labels are available only after permission. Enumeration failure does not break voice.
      void navigator.mediaDevices.enumerateDevices?.().then((devices) => {
        if (isCurrent()) options.onDevices(devices.filter((d) => d.kind === "audioinput")
          .map((d, index) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${index + 1}` })));
      }).catch(() => undefined);
      const connection = new RTCPeerConnection();
      peer = connection;
      const speaker = document.createElement("audio");
      speaker.autoplay = true;
      speaker.setAttribute("playsinline", "");
      audio = speaker;
      connection.ontrack = (event) => {
        if (!isCurrent()) return;
        speaker.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void speaker.play().catch(() => { if (isCurrent()) options.onPlaybackBlocked(); });
      };
      acquired.getAudioTracks().forEach((track) => connection.addTrack(track, acquired));
      connection.onconnectionstatechange = () => {
        if (!isCurrent()) return;
        if (["failed", "disconnected", "closed"].includes(connection.connectionState)) {
          options.onError("Voice disconnected. Your microphone is off; typed chat is still available.");
          void stop();
        }
      };
      const events = connection.createDataChannel("oai-events");
      channel = events;
      toolAbort = new AbortController();
      const signal = toolAbort.signal;
      const send = (event: unknown) => {
        if (isCurrent() && events.readyState === "open") events.send(JSON.stringify(event));
      };
      events.onopen = () => {
        if (!isCurrent()) return;
        clearTimeout(connectionDeadline);
        resting();
      };
      events.onerror = events.onclose = () => {
        if (!isCurrent()) return;
        options.onError("The voice connection closed. Please reconnect or continue by typing.");
        void stop();
      };
      async function handleTools(event: RealtimeEvent, speechAtResponse: number) {
        const outputs = event.response?.output;
        if (!Array.isArray(outputs)) return;
        let returned = false;
        for (const item of outputs) {
          if (!isCurrent()) return;
          if (item.type !== "function_call" || !item.call_id || callIds.has(item.call_id)) continue;
          if (++toolCount > 16 || item.call_id.length > 200) {
            options.onError("This voice session has reached its tool limit. Start a new session to continue.");
            await stop(); return;
          }
          callIds.add(item.call_id);
          let result: AssistantToolResult;
          try {
            if (!item.name || !item.arguments || item.arguments.length > 16_000) throw new Error("Invalid tool request");
            const args: unknown = JSON.parse(item.arguments);
            if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments");
            setState("thinking");
            result = await options.request<AssistantToolResult>(`${ASSISTANT_API}/tools`,
              { name: item.name, arguments: args }, signal);
            if (!isCurrent()) return;
            options.onToolResult(result);
          } catch {
            if (!isCurrent()) return;
            result = { ok: false, summary: "The CRM tool did not complete. No action was taken. Ask the operator to retry in the CRM.", cards: [] };
          }
          send({ type: "conversation.item.create", item: {
            type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result),
          } });
          returned = true;
        }
        // Do not restart an older response over a newly spoken user turn.
        if (returned && speechAtResponse === speechVersion) send({ type: "response.create" });
      }
      events.onmessage = (message) => {
        if (!isCurrent() || typeof message.data !== "string") return;
        if (message.data.length > 96_000) {
          options.onError("Voice received an oversized event. Please start a new session."); void stop(); return;
        }
        let event: RealtimeEvent;
        try { event = JSON.parse(message.data) as RealtimeEvent; } catch { return; }
        if (!event || typeof event !== "object") return;
        switch (event.type) {
          case "input_audio_buffer.speech_started": speechVersion += 1; resting(); break;
          case "input_audio_buffer.speech_stopped":
          case "response.created": setState("thinking"); break;
          case "output_audio_buffer.started": setState("speaking"); break;
          case "output_audio_buffer.stopped":
          case "output_audio_buffer.cleared": resting(); break;
          case "conversation.item.input_audio_transcription.completed":
            if (event.item_id && typeof event.transcript === "string") options.onTranscript({
              id: event.item_id, role: "user", text: event.transcript.slice(0, 12_000), final: true,
            });
            break;
          case "response.output_audio_transcript.done":
          case "response.output_text.done": {
            const text = event.transcript ?? event.text;
            if (event.item_id && typeof text === "string") options.onTranscript({
              id: event.item_id, role: "assistant", text: text.slice(0, 12_000), final: true,
            });
            break;
          }
          case "response.done": {
            const response = event.response;
            if (!response?.id || responseIds.has(response.id)) break;
            if (responseIds.size >= 100) { void stop(); break; }
            responseIds.add(response.id);
            if (response.status === "failed" || response.status === "incomplete") {
              options.onError("The voice response could not finish. Please try a shorter request or use typed chat.");
              resting(); break;
            }
            if (response.status !== "completed") break;
            const speechAtResponse = speechVersion;
            work = work.then(() => handleTools(event, speechAtResponse)).catch(() => {
              if (isCurrent()) { options.onError("The CRM lookup could not finish. Please try again."); resting(); }
            });
            break;
          }
          case "conversation.item.input_audio_transcription.failed":
            options.onError("That voice transcript was unavailable. Please check the draft carefully or type your correction.");
            break;
          case "error":
            options.onError("The voice service reported an error. Please reconnect or use typed chat.");
            void stop(); break;
        }
      };
      const offer = await connection.createOffer();
      if (!isCurrent()) return;
      await connection.setLocalDescription(offer);
      if (!isCurrent()) return;
      const sdp = connection.localDescription?.sdp;
      if (!sdp) throw new Error("Missing SDP");
      // Do not abort create on Stop: consume a late answer so its owner-bound call can be hung up.
      const answer = await options.request<VoiceAnswer>(`${ASSISTANT_API}/voice`, { sdp, requestId: crypto.randomUUID() });
      if (!isCurrent()) { if (answer.sessionId) await hangup(answer.sessionId); return; }
      sessionId = answer.sessionId;
      if (typeof answer.sdp !== "string" || !answer.sdp.startsWith("v=0") || !sessionId) throw new Error("Invalid voice answer");
      await connection.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (!isCurrent()) return;
      const seconds = Number.isFinite(answer.maxSeconds) ? Math.max(1, Math.min(VOICE_MAX_SECONDS, answer.maxSeconds)) : VOICE_MAX_SECONDS;
      // This is a foreground UX timer, not a durable server-side provider spending limit.
      deadline = setTimeout(() => {
        if (!isCurrent()) return;
        options.onError("This five-minute voice session has ended. Start another whenever you are ready.");
        void stop();
      }, seconds * 1000);
    } catch (error) {
      if (!isCurrent()) return;
      const name = error instanceof Error ? error.name : "";
      options.onError(name === "NotAllowedError"
        ? "Microphone permission was not granted. Allow it in browser settings or keep using typed chat."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "That microphone is not available. Choose another device or use typed chat."
          : "Voice could not connect. Check your connection and assistant setup, or continue by typing.");
      await stop();
    }
  }
  return {
    start,
    stop,
    mute(value: boolean) {
      muted = value;
      media?.getAudioTracks().forEach((track) => { track.enabled = !value; });
      if (state !== "idle" && state !== "connecting") resting();
    },
    async resumePlayback() {
      if (!audio) return;
      try { await audio.play(); } catch {
        options.onPlaybackBlocked();
        throw new Error("Audio playback needs browser permission.");
      }
    },
  };
}
