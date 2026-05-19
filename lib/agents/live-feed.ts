import type { ControlPlaneSnapshot } from "@/lib/agent-control-plane";

export type TimelineFilter = "all" | "tasks" | "comments" | "status" | "decisions";
export type ActivityKind = "heartbeat" | "alert" | "bug" | "decision";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  timeline: Exclude<TimelineFilter, "all">;
  title: string;
  detail: string;
  ts: number;
}

function toTs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildLiveFeedItems(snapshot: ControlPlaneSnapshot | null): ActivityItem[] {
  if (!snapshot) return [];

  const items: ActivityItem[] = [];

  for (const agent of snapshot.agents) {
    if (!agent.lastSeenAt) continue;
    items.push({
      id: `heartbeat:${agent.id}:${agent.lastSeenAt}`,
      kind: "heartbeat",
      timeline: "status",
      title: `${agent.label} heartbeat`,
      detail: agent.channels.length > 0 ? `Channels: ${agent.channels.join(", ")}` : "No active channels",
      ts: toTs(agent.lastSeenAt),
    });
  }

  for (const alert of snapshot.diagnostics.alerts) {
    items.push({
      id: `alert:${alert.alertId}`,
      kind: "alert",
      timeline: "tasks",
      title: alert.title,
      detail: `${alert.status.toUpperCase()} • ${alert.message}`,
      ts: toTs(alert.createdAt),
    });
  }

  for (const bug of snapshot.diagnostics.bugs) {
    items.push({
      id: `bug:${bug.fingerprint}`,
      kind: "bug",
      timeline: "comments",
      title: bug.message || bug.route || bug.fingerprint,
      detail: `${bug.count} hits • ${bug.triageStatus}`,
      ts: toTs(bug.lastSeenAt),
    });
  }

  for (const [index, recommendation] of snapshot.diagnostics.recommendations.entries()) {
    items.push({
      id: `decision:${index}`,
      kind: "decision",
      timeline: "decisions",
      title: "Control-plane recommendation",
      detail: recommendation,
      ts: toTs(snapshot.generatedAt) - index,
    });
  }

  return items.sort((a, b) => b.ts - a.ts).slice(0, 20);
}

export function summarizeLiveFeed(items: ActivityItem[]): {
  all: number;
  tasks: number;
  comments: number;
  status: number;
  decisions: number;
} {
  return {
    all: items.length,
    tasks: items.filter((item) => item.timeline === "tasks").length,
    comments: items.filter((item) => item.timeline === "comments").length,
    status: items.filter((item) => item.timeline === "status").length,
    decisions: items.filter((item) => item.timeline === "decisions").length,
  };
}

export function filterLiveFeed(items: ActivityItem[], timeline: TimelineFilter): ActivityItem[] {
  if (timeline === "all") return items;
  return items.filter((item) => item.timeline === timeline);
}

