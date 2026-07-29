import type { RosserGalleryIntakeLeadV1 } from "@/lib/crm/rosser-gallery-intake-contract";
import type { RosserGalleryIntakeConfig } from "@/lib/crm/rosser-gallery-intake-config";

export type IntakeNotificationChannel =
  | "owner_alert"
  | "submitter_acknowledgment";

export interface IntakeNotificationDraft {
  channel: IntakeNotificationChannel;
  recipient: string;
  templateVersion: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

const laneLabels: Record<RosserGalleryIntakeLeadV1["lane"], string> = {
  artist_call: "your artist-call submission",
  vendor_interest: "the way you would like to contribute as a vendor",
  program_proposal: "your speaker, workshop, or program idea",
  gallery_support: "the support you would like to share with the gallery",
  community_signup: "joining this growing community",
  contact_message: "your message",
  meeting_interest: "the time you would like to spend in conversation with us",
};

const nextStepCopy: Record<RosserGalleryIntakeLeadV1["lane"], string> = {
  artist_call:
    "I’ll take time with your work and the story around it. If there is anything else you want me to understand, reply to this email and add it to the conversation.",
  vendor_interest:
    "I’ll review how your offering may fit the gallery experience. You can reply here with any helpful details, photos, or context.",
  program_proposal:
    "I’ll sit with the idea and look for the strongest point of alignment. Reply here if there is anything else you want me to know.",
  gallery_support:
    "Every honest offer of support matters. I’ll review what you shared and follow up with a thoughtful next step.",
  community_signup:
    "I’m grateful to have you in the circle. Keep an eye on your inbox for the next meaningful way to gather, make, and grow together.",
  contact_message:
    "I’ll give your note the care it deserves. If another thought comes to you, reply here and keep the conversation moving.",
  meeting_interest:
    "I’ll review the kind of conversation you’re looking for and follow up with a clear next step for finding the right time. You can reply here if there is anything else you want me to hold in mind.",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function ownerTemplateVersion(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"]
): string {
  return businessUnit === "rosser_gallery"
    ? "rosser-gallery-owner-intake-v1"
    : "rt-solutions-owner-intake-v1";
}

function acknowledgmentTemplateVersion(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"]
): string {
  return businessUnit === "rosser_gallery"
    ? "rosser-gallery-thank-you-v1"
    : "rt-solutions-thank-you-v1";
}

export function expectedIntakeNotificationTemplateVersion(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"],
  channel: IntakeNotificationChannel
): string {
  return channel === "owner_alert"
    ? ownerTemplateVersion(businessUnit)
    : acknowledgmentTemplateVersion(businessUnit);
}

export function buildIntakeNotificationDrafts(
  payload: RosserGalleryIntakeLeadV1,
  config: RosserGalleryIntakeConfig
): [IntakeNotificationDraft, IntakeNotificationDraft] {
  const brand =
    payload.businessUnit === "rosser_gallery" ? "Rosser Gallery" : "RT Solutions";
  const ownerRecipient = config.notificationOwnerEmails[payload.businessUnit];
  const ownerLines = [
    `A new ${brand} intake arrived.`,
    "",
    `Lane: ${payload.lane}`,
    `Name: ${payload.contact.name}`,
    `Email: ${payload.contact.email}`,
    ...(payload.contact.phone ? [`Phone: ${payload.contact.phone}`] : []),
    ...(payload.intent ? [`Meeting intent: ${payload.intent}`] : []),
    ...(payload.pagePath ? [`Page: ${payload.pagePath}`] : []),
    "",
    payload.summary,
    "",
    `CRM event: ${payload.externalEventId}`,
  ];
  const ownerText = ownerLines.join("\n");

  const greetingName = firstName(payload.contact.name);
  const acknowledgmentText = [
    `Hi ${greetingName},`,
    "",
    `Thank you for sharing your time, patience, and energy with ${brand}. I’m grateful you reached out about ${laneLabels[payload.lane]}. I received what you shared, and I’ll give it the care it deserves.`,
    "",
    nextStepCopy[payload.lane],
    "",
    "With appreciation,",
    "Marcus",
    brand,
  ].join("\n");

  return [
    {
      channel: "owner_alert",
      recipient: ownerRecipient,
      templateVersion: ownerTemplateVersion(payload.businessUnit),
      subject: `New ${brand} ${payload.lane.replace(/_/g, " ")} submission`,
      textBody: ownerText,
      htmlBody: `<div>${ownerLines.map((line) => escapeHtml(line) || "&nbsp;").join("<br>")}</div>`,
    },
    {
      channel: "submitter_acknowledgment",
      recipient: payload.contact.email,
      templateVersion: acknowledgmentTemplateVersion(payload.businessUnit),
      subject:
        payload.businessUnit === "rosser_gallery"
          ? "Thank you for sharing with Rosser Gallery"
          : "Thank you for connecting with RT Solutions",
      textBody: acknowledgmentText,
      htmlBody: `<div>${acknowledgmentText
        .split("\n")
        .map((line) => escapeHtml(line) || "&nbsp;")
        .join("<br>")}</div>`,
    },
  ];
}

export function computeIntakeNotificationRetryAt(
  attemptCount: number,
  failedAt: Date
): string {
  const boundedAttempt = Math.max(1, Math.floor(attemptCount));
  const delaySeconds = Math.min(3_600, 30 * 2 ** Math.min(6, boundedAttempt - 1));
  return new Date(failedAt.getTime() + delaySeconds * 1_000).toISOString();
}

export function nextIntakeNotificationFailureState(args: {
  attemptCount: number;
  maxAttempts: number;
  failedAt: Date;
}): { status: "queued" | "dead_letter"; nextAttemptAt: string | null } {
  if (args.attemptCount >= args.maxAttempts) {
    return { status: "dead_letter", nextAttemptAt: null };
  }
  return {
    status: "queued",
    nextAttemptAt: computeIntakeNotificationRetryAt(args.attemptCount, args.failedAt),
  };
}
