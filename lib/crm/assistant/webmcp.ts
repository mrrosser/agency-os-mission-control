import { ASSISTANT_API, type AssistantRequest, type AssistantToolResult } from "./contracts";
import { ASSISTANT_TOOLS } from "./catalog";

type ModelContext = {
  registerTool: (tool: {
    name: string; description: string; inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean };
    execute: (args: unknown, context?: { signal?: AbortSignal }) => Promise<AssistantToolResult>;
  }, options: { signal: AbortSignal }) => Promise<void>;
};
function modelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}
export function supportsCrmSiteTools(): boolean {
  return typeof modelContext()?.registerTool === "function";
}

/** Optional, operator-enabled same-origin site tools. Ordinary chat/voice never depends on WebMCP. */
export function registerCrmSiteTools(options: {
  request: AssistantRequest;
  onResult: (result: AssistantToolResult) => void;
  onError?: (message: string) => void;
}): () => void {
  const context = modelContext();
  if (!context || !supportsCrmSiteTools()) return () => undefined;
  const lifetime = new AbortController();
  void (async () => {
    try {
      for (const tool of ASSISTANT_TOOLS) {
        if (lifetime.signal.aborted) return;
        await context.registerTool({
          ...tool,
          // Even read-only tools update visible receipts, and their returned CRM content is untrusted data.
          execute: async (args, execution) => {
            if (lifetime.signal.aborted || execution?.signal?.aborted) throw new Error("CRM site tools are no longer active.");
            if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 16_000) {
              throw new Error("Invalid CRM tool arguments.");
            }
            const pending = new AbortController();
            const abort = () => pending.abort();
            lifetime.signal.addEventListener("abort", abort, { once: true });
            execution?.signal?.addEventListener("abort", abort, { once: true });
            try {
              const result = await options.request<AssistantToolResult>(`${ASSISTANT_API}/tools`,
                { name: tool.name, arguments: args }, pending.signal);
              if (pending.signal.aborted) throw new Error("CRM tool request was cancelled.");
              options.onResult(result);
              return result;
            } finally {
              lifetime.signal.removeEventListener("abort", abort);
              execution?.signal?.removeEventListener("abort", abort);
            }
          },
        }, { signal: lifetime.signal });
      }
    } catch {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      options.onError?.("Site tools could not be registered in this browser. Typed chat and voice are still available.");
    }
  })();
  return () => lifetime.abort();
}
