export type OutcomeGateId =
  | "throughput"
  | "qualification"
  | "meeting"
  | "revenue"
  | "pipeline";

export type OutcomeGateStatus = "pass" | "warn" | "fail";

export type OutcomeGateCriticalId = "throughput" | "revenue";

export interface OutcomeGate {
  id: OutcomeGateId;
  label: string;
  status: OutcomeGateStatus;
  threshold: string;
  actual: string;
}

export interface OutcomeGateSummary {
  passCount: number;
  warnCount: number;
  failCount: number;
  passOrWarnCount: number;
}

export interface OutcomeGateEvaluation {
  gates: OutcomeGate[];
  summary: OutcomeGateSummary;
  criticalGateFailures: OutcomeGateCriticalId[];
}

export interface OutcomeGateInputSummary {
  leadsSourced: number;
  qualifiedLeads: number;
  meetingsBooked: number;
  depositsCollected: number;
  pipelineValueUsd: number;
}

export interface OutcomeGateReadinessWeek {
  weekStartDate: string;
  passOrWarnCount: number;
  ready: boolean;
}

export interface OutcomeGateReadinessSummary {
  minimumPassOrWarnGates: number;
  targetConsecutiveWeeks: number;
  consecutiveReadyWeeks: number;
  meetsTarget: boolean;
  evaluatedWeeks: number;
  weeks: OutcomeGateReadinessWeek[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function statusFromFloorThresholds(value: number, passMin: number, warnMin: number): OutcomeGateStatus {
  if (value >= passMin) return "pass";
  if (value >= warnMin) return "warn";
  return "fail";
}

function buildSummary(gates: OutcomeGate[]): OutcomeGateSummary {
  const passCount = gates.filter((gate) => gate.status === "pass").length;
  const warnCount = gates.filter((gate) => gate.status === "warn").length;
  const failCount = gates.filter((gate) => gate.status === "fail").length;
  return {
    passCount,
    warnCount,
    failCount,
    passOrWarnCount: passCount + warnCount,
  };
}

export function evaluateOutcomeGatesFromSummary(
  summary: OutcomeGateInputSummary
): OutcomeGateEvaluation {
  const leadsSourced = Math.floor(asNonNegativeNumber(summary.leadsSourced));
  const qualifiedLeads = Math.floor(asNonNegativeNumber(summary.qualifiedLeads));
  const meetingsBooked = Math.floor(asNonNegativeNumber(summary.meetingsBooked));
  const depositsCollected = Math.floor(asNonNegativeNumber(summary.depositsCollected));
  const pipelineValueUsd = round2(asNonNegativeNumber(summary.pipelineValueUsd));

  const qualificationRatePct =
    leadsSourced > 0 ? round2((qualifiedLeads / leadsSourced) * 100) : 0;
  const meetingRatePct = leadsSourced > 0 ? round2((meetingsBooked / leadsSourced) * 100) : 0;

  const throughput: OutcomeGate = {
    id: "throughput",
    label: "Lead Throughput",
    status: statusFromFloorThresholds(leadsSourced, 10, 5),
    threshold: "pass >= 10, warn 5-9, fail < 5 sourced leads/week",
    actual: `${leadsSourced} sourced lead(s)`,
  };

  const qualification: OutcomeGate = {
    id: "qualification",
    label: "Qualification",
    status: statusFromFloorThresholds(qualificationRatePct, 20, 10),
    threshold: "pass >= 20%, warn 10-19.9%, fail < 10% (qualified/sourced)",
    actual: `${qualifiedLeads}/${leadsSourced} (${qualificationRatePct}%)`,
  };

  const meeting: OutcomeGate = {
    id: "meeting",
    label: "Meeting Rate",
    status: statusFromFloorThresholds(meetingRatePct, 15, 8),
    threshold: "pass >= 15%, warn 8-14.9%, fail < 8% (booked/sourced)",
    actual: `${meetingsBooked}/${leadsSourced} (${meetingRatePct}%)`,
  };

  const revenueStatus: OutcomeGateStatus =
    depositsCollected >= 1 ? "pass" : meetingsBooked >= 2 ? "warn" : "fail";
  const revenue: OutcomeGate = {
    id: "revenue",
    label: "Revenue",
    status: revenueStatus,
    threshold: "pass >= 1 deposit; warn 0 deposits with >= 2 meetings; fail otherwise",
    actual: `${depositsCollected} deposit(s), ${meetingsBooked} meeting(s)`,
  };

  const pipeline: OutcomeGate = {
    id: "pipeline",
    label: "Pipeline Value",
    status: statusFromFloorThresholds(pipelineValueUsd, 5000, 2000),
    threshold: "pass >= $5000, warn $2000-$4999, fail < $2000 active pipeline",
    actual: `$${pipelineValueUsd}`,
  };

  const gates = [throughput, qualification, meeting, revenue, pipeline];
  const gateSummary = buildSummary(gates);
  const criticalGateFailures = gates
    .filter(
      (gate): gate is OutcomeGate & { id: OutcomeGateCriticalId } =>
        (gate.id === "throughput" || gate.id === "revenue") && gate.status === "fail"
    )
    .map((gate) => gate.id);

  return {
    gates,
    summary: gateSummary,
    criticalGateFailures,
  };
}

export function isOutcomeGateReady(
  evaluation: OutcomeGateEvaluation | null | undefined,
  minimumPassOrWarnGates = 3
): boolean {
  return Boolean(evaluation && evaluation.summary.passOrWarnCount >= minimumPassOrWarnGates);
}

export function summarizeConsecutiveOutcomeGateReadiness(
  weeks: Array<{ weekStartDate: string; outcomeGates: OutcomeGateEvaluation | null | undefined }>,
  options?: {
    minimumPassOrWarnGates?: number;
    targetConsecutiveWeeks?: number;
  }
): OutcomeGateReadinessSummary {
  const minimumPassOrWarnGates = Math.max(1, Math.floor(options?.minimumPassOrWarnGates ?? 3));
  const targetConsecutiveWeeks = Math.max(1, Math.floor(options?.targetConsecutiveWeeks ?? 2));

  const sorted = [...weeks].sort((a, b) =>
    String(b.weekStartDate).localeCompare(String(a.weekStartDate))
  );

  const readinessWeeks: OutcomeGateReadinessWeek[] = sorted
    .filter((item) => item.outcomeGates)
    .map((item) => ({
      weekStartDate: item.weekStartDate,
      passOrWarnCount: item.outcomeGates?.summary.passOrWarnCount ?? 0,
      ready: isOutcomeGateReady(item.outcomeGates, minimumPassOrWarnGates),
    }));

  let consecutiveReadyWeeks = 0;
  for (const week of readinessWeeks) {
    if (!week.ready) break;
    consecutiveReadyWeeks += 1;
  }

  return {
    minimumPassOrWarnGates,
    targetConsecutiveWeeks,
    consecutiveReadyWeeks,
    meetsTarget: consecutiveReadyWeeks >= targetConsecutiveWeeks,
    evaluatedWeeks: readinessWeeks.length,
    weeks: readinessWeeks,
  };
}
