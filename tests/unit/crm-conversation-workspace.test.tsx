import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantResultCard, boundedAssistantHistory, buildAssistantRevisionMessage, ConversationWorkspace, createOwnerBoundVoiceRequest,
} from "@/components/crm/conversation-workspace";
import { ASSISTANT_API, type AssistantCard, type AssistantMessage, type AssistantRequest } from "@/lib/crm/assistant/contracts";

afterEach(() => vi.unstubAllGlobals());

describe("CRM conversation workspace boundaries", () => {
  it("renders explicit consent and disabled voice without acquiring a microphone or calling APIs", () => {
    const fetch = vi.fn();
    const getUserMedia = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const html = renderToStaticMarkup(<ConversationWorkspace user={{ uid: "operator", getIdToken: vi.fn() }} active onNavigate={() => {}} />);
    expect(html).toContain("I understand AI requests send my text");
    expect(html).toContain("needed CRM tool results to OpenAI");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start voice<\/button>/);
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Check availability again");
    expect(html).toContain("not local storage");
    expect(html).toContain("Nothing here automatically saves contacts");
    expect(html).toContain("survey response collection are not connected");
    expect(fetch).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("renders editable drafts as unapproved local proposals and escapes text", () => {
    const card: AssistantCard = {
      id: "proposal", kind: "draft", title: "Community <script>alert(1)</script>", body: "Review this proposal.",
      draft: { subject: "Hello, Zoë & friends", body: "A new line.\nCome through ✨", format: "newsletter" },
    };
    const html = renderToStaticMarkup(<AssistantResultCard card={card} onNavigate={() => {}} />);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Not approved, published, or sent");
    expect(html).toContain("Subject or title");
    expect(html).toContain("Draft body");
    expect(html).toContain("A new line.\nCome through ✨");
    expect(html).toContain("Copy current draft");
    expect(html).toContain("Download .txt");
    expect(html).not.toContain(">Save<");
  });

  it("accepts navigation only to an existing CRM workspace", () => {
    const valid: AssistantCard = { id: "nav", kind: "navigation", title: "People", body: "Review contacts", destination: "people" };
    expect(renderToStaticMarkup(<AssistantResultCard card={valid} onNavigate={() => {}} />)).toContain("Open People");
    const invalid = { ...valid, destination: "https://unexpected.example" } as unknown as AssistantCard;
    const html = renderToStaticMarkup(<AssistantResultCard card={invalid} onNavigate={() => {}} />);
    expect(html).not.toContain("https://unexpected.example");
    expect(html).not.toContain("crm-assistant-next");
  });

  it("offers explicit draft revision and preserves edited Unicode and newlines without silent truncation", () => {
    const subject = "Hello, Zoë ✨";
    const body = "First line.\n\nA revised second line.";
    const message = buildAssistantRevisionMessage(subject, body);
    expect(message).toContain(`Subject: ${subject}\n\nBody:\n${body}`);
    expect(message).toContain("not instructions to send, save, or publish");
    expect(buildAssistantRevisionMessage(subject, "x".repeat(4000))).toBeNull();
    const card: AssistantCard = { id: "revise", kind: "draft", title: "Review", body: "Proposal", draft: { subject, body, format: "newsletter" } };
    const onRevise = vi.fn();
    const html = renderToStaticMarkup(<AssistantResultCard card={card} onNavigate={() => {}} onRevise={onRevise} />);
    expect(html).toContain("Revise with Assistant");
    expect(html).toContain("Manual edits are not automatically shared back");
    expect(onRevise).not.toHaveBeenCalled();
  });

  it("keeps the newest ten messages within both per-message and total server limits", () => {
    const messages: AssistantMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `${index}: ${"x".repeat(5000)}` }));
    const original = JSON.stringify(messages);
    const history = boundedAssistantHistory(messages);
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history.every((message) => message.content.length <= 4000)).toBe(true);
    expect(history.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(20_000);
    expect(history.at(-1)?.content).toBe(messages.at(-1)?.content.slice(0, 4000));
    expect(history[0].content).toMatch(/^7:/);
    expect(JSON.stringify(messages)).toBe(original);
    expect(boundedAssistantHistory(Array.from({ length: 12 }, () => ({ role: "user", content: "Short" })))).toHaveLength(10);
    expect(boundedAssistantHistory([{ role: "user", content: " \n " }])).toEqual([]);
  });

  it("has no transcript persistence, raw-HTML rendering, or automatic site-tool opt-in", () => {
    const source = readFileSync("components/crm/conversation-workspace.tsx", "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|dangerouslySetInnerHTML/);
    expect(source).toContain("const [siteToolsEnabled, setSiteToolsEnabled] = useState(false)");
    expect(source).toContain("onChange={(event) => toggleSiteTools(event.target.checked)}");
    expect(source).toContain('document.visibilityState === "hidden"');
    expect(source).toContain("onError: (message) => {\n          registrationFailed = true;");
    const css = readFileSync("components/crm/conversation-workspace.css", "utf8");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("places compact mobile voice after consent and before conversation without duplicated IDs", () => {
    const html = renderToStaticMarkup(<ConversationWorkspace user={null} active onNavigate={() => {}} />);
    const consent = html.indexOf('class="crm-assistant-consent"');
    const compact = html.indexOf('class="crm-assistant-mobile-voice"');
    const starters = html.indexOf('class="crm-assistant-starters"');
    expect(consent).toBeLessThan(compact);
    expect(compact).toBeLessThan(starters);
    expect(html).toContain('href="#crm-assistant-voice-settings"');
    expect(html).toContain('id="crm-assistant-heading" tabindex="-1"');
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const css = readFileSync("components/crm/conversation-workspace.css", "utf8");
    expect(css).toContain(".crm-assistant-mobile-voice { display:none; }");
    expect(css).toContain(".crm-assistant-desktop-voice-controls { display:none; }");
    const workbench = readFileSync("components/crm/operator-workbench.tsx", "utf8");
    expect(workbench).toContain('if (next === "assistant")');
    expect(workbench).toContain('heading.scrollIntoView({ block: "start", behavior: "instant" })');
  });
});

describe("owner-bound voice transport", () => {
  const delegate = vi.fn() as unknown as AssistantRequest;

  it("allows only cleanup after consent, activity, or owner changes and keeps the original bearer", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stopped: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const request = createOwnerBoundVoiceRequest({ token: "synthetic-original-owner", mayStart: () => false, request: delegate });
    await expect(request(`${ASSISTANT_API}/voice`, { sdp: "v=0" })).rejects.toMatchObject({ name: "AbortError" });
    await expect(request(`${ASSISTANT_API}/tools`, { name: "get_crm_summary" })).rejects.toMatchObject({ name: "AbortError" });
    await expect(request(`${ASSISTANT_API}/voice/stop`, { sessionId: "owned-session" })).resolves.toEqual({ stopped: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe(`${ASSISTANT_API}/voice/stop`);
    expect(options.headers.Authorization).toBe("Bearer synthetic-original-owner");
    expect(options.keepalive).toBe(true);
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("same-origin");
    expect(JSON.parse(options.body)).toEqual({ sessionId: "owned-session" });
  });

  it("preserves a late voice-create receipt after Stop so the controller can hang it up", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    let active = true;
    const request = createOwnerBoundVoiceRequest({ token: "synthetic-owner", mayStart: () => active, request: delegate });
    const stopSignal = new AbortController();
    const pending = request(`${ASSISTANT_API}/voice`, { sdp: "v=0" }, stopSignal.signal);
    active = false;
    stopSignal.abort();
    expect(fetch.mock.calls[0][1].signal).not.toBe(stopSignal.signal);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    resolve(new Response(JSON.stringify({ sdp: "v=0", sessionId: "late-owned-call", maxSeconds: 300 }), { status: 200 }));
    await expect(pending).resolves.toMatchObject({ sessionId: "late-owned-call" });
  });

  it("delegates allowed tool requests through the ordinary abortable gateway", async () => {
    const fetch = vi.fn();
    const ordinary = vi.fn().mockResolvedValue({ ok: true }) as unknown as AssistantRequest;
    vi.stubGlobal("fetch", fetch);
    const request = createOwnerBoundVoiceRequest({ token: "synthetic-owner", mayStart: () => true, request: ordinary });
    const signal = new AbortController().signal;
    await expect(request(`${ASSISTANT_API}/tools`, { name: "get_crm_summary", arguments: {} }, signal)).resolves.toEqual({ ok: true });
    expect(ordinary).toHaveBeenCalledWith(`${ASSISTANT_API}/tools`, { name: "get_crm_summary", arguments: {} }, signal);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose provider response bodies or credential details in errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("synthetic-sensitive-provider-detail", { status: 503 })));
    const request = createOwnerBoundVoiceRequest({ token: "synthetic-owner", mayStart: () => true, request: delegate });
    await expect(request(`${ASSISTANT_API}/voice`, {})).rejects.toThrow("not configured or is temporarily unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-secret")));
    await expect(request(`${ASSISTANT_API}/voice/stop`, {})).rejects.toThrow("The voice connection could not be confirmed.");
  });
});
