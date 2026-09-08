import type { AssistantToolDefinition } from "./contracts";

const noArguments = { type: "object", properties: {}, required: [], additionalProperties: false };
const readOnly = { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false };

/** Browser-safe fixed catalog. Descriptions are not authorization; the server revalidates every call. */
export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    name: "get_crm_summary",
    description: "Read aggregate counts, sources, permissions and freshness for the signed-in owner's CRM registry. Contact points are not newsletter subscribers. Does not search individual contacts or read inbox replies.",
    inputSchema: noArguments,
    annotations: readOnly,
  },
  {
    name: "get_outreach_review",
    description: "Read the existing warm-reconnection copy preview and aggregate audience context. This static review is not live sending readiness or approval. Does not send, schedule, enroll, or inspect inbox engagement.",
    inputSchema: noArguments,
    annotations: readOnly,
  },
  {
    name: "get_share_cards",
    description: "Show existing public Rosser Gallery and RT Solutions contact links, QR images and vCards. No new QR or contact is created. Sharing or scanning does not automatically establish CRM intake or newsletter consent.",
    inputSchema: noArguments,
    annotations: readOnly,
  },
  {
    name: "prepare_draft",
    description: "Prepare an editable session-local newsletter, reply, survey, or intake proposal using supplied subject and body. Not saved to CRM or Gmail, sent, published, or approved. Do not invent dates, prices, attendee facts, replies, or consent. Clearly mark unknown details for review.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["newsletter", "reply", "survey", "intake"] },
        subject: { type: "string", minLength: 1, maxLength: 160 },
        body: { type: "string", minLength: 1, maxLength: 6000 },
      },
      required: ["format", "subject", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  },
];
