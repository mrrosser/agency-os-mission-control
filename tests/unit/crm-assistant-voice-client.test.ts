import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCrmVoiceController } from "@/lib/crm/assistant/voice-client";
import type { AssistantRequest } from "@/lib/crm/assistant/contracts";

class FakeChannel {
  readyState = "open";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
class FakePeer {
  static latest: FakePeer;
  channel = new FakeChannel();
  connectionState = "new";
  localDescription = { sdp: "v=0\r\nlocal-offer" };
  ontrack: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { FakePeer.latest = this; }
  addTrack = vi.fn(); close = vi.fn();
  createOffer = vi.fn(async () => this.localDescription);
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => { this.channel.onopen?.(); });
  createDataChannel() { return this.channel; }
}
const track = () => ({ stop: vi.fn(), enabled: true, onended: null as (() => void) | null });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

describe("CRM voice browser transport", () => {
  let microphone: ReturnType<typeof track>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let documentMock: EventTarget & { visibilityState: string; createElement: ReturnType<typeof vi.fn> };
  let audioMock: { autoplay: boolean; srcObject: unknown; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn> };
  const callbacks = () => ({ onState: vi.fn(), onTranscript: vi.fn(), onToolResult: vi.fn(), onError: vi.fn(), onPlaybackBlocked: vi.fn(), onDevices: vi.fn() });
  beforeEach(() => {
    vi.useFakeTimers();
    microphone = track();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }));
    audioMock = { autoplay: false, srcObject: null, play: vi.fn(async () => undefined), pause: vi.fn(), remove: vi.fn(), setAttribute: vi.fn() };
    documentMock = Object.assign(new EventTarget(), { visibilityState: "visible", createElement: vi.fn(() => audioMock) });
    vi.stubGlobal("window", Object.assign(new EventTarget(), { isSecureContext: true }));
    vi.stubGlobal("document", documentMock);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: vi.fn(async () => [{ kind: "audioinput", deviceId: "mic-1", label: "USB microphone" }]) } });
    vi.stubGlobal("RTCPeerConnection", FakePeer);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup() {
    const request = vi.fn(async (path: string) => path.endsWith("/voice")
      ? { sdp: "v=0\r\nanswer", sessionId: "owned-session", maxSeconds: 300 }
      : path.endsWith("/tools") ? { ok: true, summary: "Observed totals", cards: [] } : { success: true });
    const cb = callbacks();
    return { request, cb, controller: createCrmVoiceController({ request: request as AssistantRequest, ...cb }) };
  }
  it("does not request microphone until explicit Start; Stop releases all media and owner session", async () => {
    const { controller, request, cb } = setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    await controller.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(cb.onState).toHaveBeenLastCalledWith("listening");
    controller.mute(true); expect(microphone.enabled).toBe(false);
    controller.mute(false); expect(microphone.enabled).toBe(true);
    await controller.stop();
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(FakePeer.latest.close).toHaveBeenCalledOnce();
    expect(audioMock.pause).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/crm/assistant/voice/stop", { sessionId: "owned-session" });
    expect(cb.onState).toHaveBeenLastCalledWith("idle");
  });
  it("releases a microphone granted after Stop, without creating a provider call", async () => {
    const permission = deferred<unknown>(); getUserMedia.mockReturnValue(permission.promise);
    const { controller, request } = setup();
    const starting = controller.start();
    await controller.stop();
    permission.resolve({ getTracks: () => [microphone], getAudioTracks: () => [microphone] });
    await starting;
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });
  it("consumes a late SDP answer to hang up a call created while Stop was pressed", async () => {
    const answer = deferred<unknown>();
    const request = vi.fn(async (path: string) => path.endsWith("/voice") ? answer.promise : { success: true });
    const controller = createCrmVoiceController({ request: request as AssistantRequest, ...callbacks() });
    const starting = controller.start(); await flush();
    expect(request).toHaveBeenCalledOnce();
    await controller.stop();
    answer.resolve({ sdp: "v=0\r\nanswer", sessionId: "late-session", maxSeconds: 300 });
    await starting;
    expect(request).toHaveBeenCalledWith("/api/crm/assistant/voice/stop", { sessionId: "late-session" });
    expect(FakePeer.latest.setRemoteDescription).not.toHaveBeenCalled();
  });
  it("does not start twice concurrently", async () => {
    const { controller, request } = setup();
    await Promise.all([controller.start(), controller.start()]);
    expect(request).toHaveBeenCalledOnce();
    await controller.stop();
  });
  it("provides a typed-chat fallback after permission denial without calling OpenAI", async () => {
    getUserMedia.mockRejectedValue(new DOMException("private browser message", "NotAllowedError"));
    const { controller, request, cb } = setup();
    await controller.start();
    expect(request).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("typed chat"));
    expect(cb.onError).not.toHaveBeenCalledWith(expect.stringContaining("private browser message"));
    expect(cb.onState).toHaveBeenLastCalledWith("idle");
  });
  it("stops on hidden page and on connection failure", async () => {
    const { controller, request } = setup(); await controller.start();
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent(new Event("visibilitychange")); await flush();
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/crm/assistant/voice/stop", { sessionId: "owned-session" });
  });
  it("times out pending permission then releases any later microphone grant", async () => {
    const permission = deferred<unknown>(); getUserMedia.mockReturnValue(permission.promise);
    const { controller, cb } = setup(); const starting = controller.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cb.onState).toHaveBeenLastCalledWith("idle");
    permission.resolve({ getTracks: () => [microphone], getAudioTracks: () => [microphone] }); await starting;
    expect(microphone.stop).toHaveBeenCalledOnce();
  });
  it("caps provider-suggested session duration at the five-minute foreground limit", async () => {
    const { controller, cb } = setup(); await controller.start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(cb.onState).toHaveBeenLastCalledWith("idle");
  });
  it("renders final input/output transcripts and de-duplicates function calls", async () => {
    const { controller, request, cb } = setup(); await controller.start();
    const events = FakePeer.latest.channel;
    events.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "user1", transcript: "Show my cards" });
    events.emit({ type: "response.output_audio_transcript.done", item_id: "reply1", transcript: "Here are your share cards." });
    expect(cb.onTranscript).toHaveBeenCalledTimes(2);
    const event = { type: "response.done", response: { id: "response1", status: "completed", output: [{ type: "function_call", call_id: "call1", name: "get_share_cards", arguments: "{}" }] } };
    events.emit(event); events.emit(event); await flush();
    expect(request.mock.calls.filter(([path]) => path.endsWith("/tools"))).toHaveLength(1);
    expect(cb.onToolResult).toHaveBeenCalledOnce();
    expect(events.send.mock.calls.map(([value]) => JSON.parse(value).type)).toEqual(["conversation.item.create", "response.create"]);
    await controller.stop();
  });
  it("never executes calls from a cancelled response", async () => {
    const { controller, request } = setup(); await controller.start();
    FakePeer.latest.channel.emit({ type: "response.done", response: { id: "cancelled", status: "cancelled", output: [{ type: "function_call", call_id: "call1", name: "get_share_cards", arguments: "{}" }] } });
    await flush(); expect(request).toHaveBeenCalledOnce(); await controller.stop();
  });
  it("does not speak an older lookup over a newly spoken turn", async () => {
    const result = deferred<unknown>();
    const request = vi.fn(async (path: string) => path.endsWith("/voice") ? { sdp: "v=0", sessionId: "session", maxSeconds: 300 } : result.promise);
    const cb = callbacks(); const controller = createCrmVoiceController({ request: request as AssistantRequest, ...cb });
    await controller.start();
    const events = FakePeer.latest.channel;
    events.emit({ type: "response.done", response: { id: "r", status: "completed", output: [{ type: "function_call", call_id: "c", name: "get_share_cards", arguments: "{}" }] } });
    await flush(); events.emit({ type: "input_audio_buffer.speech_started" });
    result.resolve({ ok: true, summary: "cards", cards: [] }); await flush();
    expect(events.send.mock.calls.map(([value]) => JSON.parse(value).type)).toEqual(["conversation.item.create"]);
    await controller.stop();
  });
  it("asks for a playback tap when mobile autoplay is blocked", async () => {
    const { controller, cb } = setup(); await controller.start();
    audioMock.play.mockRejectedValueOnce(new Error("autoplay denied"));
    FakePeer.latest.ontrack?.({ streams: [{}] }); await flush();
    expect(cb.onPlaybackBlocked).toHaveBeenCalledOnce();
    await controller.resumePlayback(); expect(audioMock.play).toHaveBeenCalledTimes(2);
    await controller.stop();
  });
});
