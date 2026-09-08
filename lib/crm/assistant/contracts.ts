/** Browser-safe conversation contracts. Never put provider credentials or auth scope here. */
export type AssistantDestination = "people" | "outreach" | "share" | "activity";
export type AssistantCard = {
  id: string;
  kind: "evidence" | "draft" | "navigation";
  title: string;
  body: string;
  destination?: AssistantDestination;
  draft?: { subject: string; body: string; format: "newsletter" | "reply" | "survey" | "intake" };
};
export type AssistantToolResult = {
  ok: boolean;
  summary: string;
  cards: AssistantCard[];
  data?: Record<string, unknown>;
};
export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantCapabilities = {
  textEnabled: boolean;
  voiceEnabled: boolean;
  toolsEnabled: boolean;
  provider: "openai";
  keyStatus: "checked_on_request";
  voiceMaxSeconds: number;
  voiceSession?: { sessionId: string; state: "connecting" | "active" | "uncertain"; canStop: boolean };
  voiceSessionUnavailable?: boolean;
};
export type AssistantChatResponse = {
  success: true;
  message: string;
  cards: AssistantCard[];
  correlationId: string;
};
export type AssistantToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean };
};
export type AssistantRequest = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export const ASSISTANT_API = "/api/crm/assistant";
export const VOICE_MAX_SECONDS = 300;
