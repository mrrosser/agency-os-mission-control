/** Browser-safe reporting contracts. Counts never imply permission to send. */
export interface WarmReconnectOutcomeMetric {
  status: "observed" | "unknown";
  value: number | null;
  observedAt: string | null;
  reason?: string;
}

export interface WarmReconnectPilotResultSummary {
  pilotId: string;
  status: string;
  tranche: string;
  batchSequence?: number;
  parentPilotId?: string;
  createdAt: string | null;
  recipientCount: number;
  recipientIds: string[];
  /** True only when unique bound sent receipts and durable executor agree. */
  complete: boolean;
  sent: WarmReconnectOutcomeMetric;
  stoppedBeforeProvider: WarmReconnectOutcomeMetric;
  deliveryUnknown: WarmReconnectOutcomeMetric;
  confirmedChoices: {
    any: WarmReconnectOutcomeMetric;
    rosserGallery: WarmReconnectOutcomeMetric;
    rtSolutions: WarmReconnectOutcomeMetric;
  };
  unsubscribed: WarmReconnectOutcomeMetric;
  replies: WarmReconnectOutcomeMetric;
  automaticResponses: WarmReconnectOutcomeMetric;
  deliveryNotices: WarmReconnectOutcomeMetric;
  bounces: WarmReconnectOutcomeMetric;
  opens: WarmReconnectOutcomeMetric;
  clicks: WarmReconnectOutcomeMetric;
  conversions: WarmReconnectOutcomeMetric;
}

export interface WarmReconnectRecipientResult {
  recipientId: string;
  greetingName: string;
  deliveryStatus: string;
  sentAt: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  terminalReason: string | null;
  topics: { rosser_gallery: boolean; rt_solutions: boolean } | null;
  unsubscribedThroughBatch: boolean | null;
}

export interface WarmReconnectPilotResult extends WarmReconnectPilotResultSummary {
  recipients: WarmReconnectRecipientResult[];
  replyObservation: {
    status: "not_observed" | "complete" | "partial";
    observedAt: string | null;
    scope: "exact_sent_threads";
    inspectedThreads: number;
    expectedThreads: number;
  };
}

export interface WarmReconnectResultsResponse {
  schemaVersion: "crm.warm-reconnect-results.v1";
  observedAt: string;
  pilots: WarmReconnectPilotResultSummary[];
  pilotsTruncated: boolean;
  selectedPilot: WarmReconnectPilotResult | null;
}
