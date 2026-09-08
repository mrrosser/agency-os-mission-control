import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCrmSiteTools, supportsCrmSiteTools } from "@/lib/crm/assistant/webmcp";
import type { AssistantRequest } from "@/lib/crm/assistant/contracts";

vi.mock("@/lib/crm/assistant/catalog", () => ({ ASSISTANT_TOOLS: [{
  name: "get_crm_summary", description: "Read scoped CRM totals", inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
}] }));
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
afterEach(() => vi.unstubAllGlobals());
describe("optional CRM WebMCP site tools", () => {
  it("does nothing in browsers without document.modelContext", () => {
    vi.stubGlobal("document", {});
    const request = vi.fn();
    expect(supportsCrmSiteTools()).toBe(false);
    registerCrmSiteTools({ request: request as AssistantRequest, onResult: vi.fn() })();
    expect(request).not.toHaveBeenCalled();
  });
  it("registers same-origin tools with abort lifecycle and authenticated gateway results", async () => {
    const registerTool = vi.fn(async () => undefined);
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const result = { ok: true, summary: "Verified evidence", cards: [] };
    const request = vi.fn(async () => result); const onResult = vi.fn();
    expect(supportsCrmSiteTools()).toBe(true);
    const cleanup = registerCrmSiteTools({ request: request as AssistantRequest, onResult }); await flush();
    const [tool, options] = registerTool.mock.calls[0] as unknown as [{ execute: (args: unknown, context?: { signal?: AbortSignal }) => Promise<unknown> }, { signal: AbortSignal; exposedTo?: unknown }];
    expect(options.exposedTo).toBeUndefined(); expect(options.signal.aborted).toBe(false);
    expect(await tool.execute({})).toEqual(result);
    expect(onResult).toHaveBeenCalledWith(result);
    expect(request).toHaveBeenCalledWith("/api/crm/assistant/tools", { name: "get_crm_summary", arguments: {} }, expect.any(AbortSignal));
    cleanup(); expect(options.signal.aborted).toBe(true);
    await expect(tool.execute({})).rejects.toThrow("no longer active");
  });
  it("rejects malformed input without invoking server; cancels pending execution on disable", async () => {
    const registerTool = vi.fn(async () => undefined);
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const request = vi.fn(async (_path: string, _body: unknown, signal: AbortSignal) => {
      await new Promise((resolve) => { signal.addEventListener("abort", resolve); });
      return { ok: true, summary: "late", cards: [] };
    });
    const onResult = vi.fn(); const cleanup = registerCrmSiteTools({ request: request as AssistantRequest, onResult }); await flush();
    const [tool] = registerTool.mock.calls[0] as unknown as [{ execute: (args: unknown) => Promise<unknown> }];
    await expect(tool.execute([])).rejects.toThrow("Invalid CRM tool arguments");
    expect(request).not.toHaveBeenCalled();
    const executing = tool.execute({}); cleanup();
    await expect(executing).rejects.toThrow("cancelled"); expect(onResult).not.toHaveBeenCalled();
  });
  it("aborts registrations cleanly when a browser rejects registration", async () => {
    const registerTool = vi.fn(async () => { throw new Error("private implementation detail"); });
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const onError = vi.fn(); const request = vi.fn();
    registerCrmSiteTools({ request: request as AssistantRequest, onResult: vi.fn(), onError }); await flush();
    const [, options] = registerTool.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }];
    expect(options.signal.aborted).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Typed chat and voice"));
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("private implementation detail"));
  });
});
