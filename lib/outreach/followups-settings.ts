import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";

export interface FollowupsOrgSettings {
  orgId: string;
  autoEnabled: boolean;
  maxTasksPerInvocation: number;
  drainDelaySeconds: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const FOLLOWUPS_SETTINGS_COLLECTION = "lead_run_org_followups";

function readBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function defaultFollowupsOrgSettings(orgId: string): FollowupsOrgSettings {
  return {
    orgId,
    autoEnabled: readBoolEnv(process.env.FOLLOWUPS_AUTO_ENABLED, true),
    maxTasksPerInvocation: clampInt(process.env.FOLLOWUPS_MAX_TASKS_PER_INVOCATION, 5, 1, 25),
    drainDelaySeconds: clampInt(process.env.FOLLOWUPS_DRAIN_DELAY_SECONDS, 30, 0, 3600),
  };
}

export async function getFollowupsOrgSettings(orgId: string, log?: Logger): Promise<FollowupsOrgSettings> {
  const defaults = defaultFollowupsOrgSettings(orgId);
  const ref = getAdminDb().collection(FOLLOWUPS_SETTINGS_COLLECTION).doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) return defaults;

  const data = (snap.data() || {}) as Partial<FollowupsOrgSettings>;
  const settings: FollowupsOrgSettings = {
    ...defaults,
    autoEnabled: typeof data.autoEnabled === "boolean" ? data.autoEnabled : defaults.autoEnabled,
    maxTasksPerInvocation: clampInt(data.maxTasksPerInvocation, defaults.maxTasksPerInvocation, 1, 25),
    drainDelaySeconds: clampInt(data.drainDelaySeconds, defaults.drainDelaySeconds, 0, 3600),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  log?.info("outreach.followups.settings.loaded", {
    orgId,
    autoEnabled: settings.autoEnabled,
    maxTasksPerInvocation: settings.maxTasksPerInvocation,
    drainDelaySeconds: settings.drainDelaySeconds,
  });

  return settings;
}

export async function patchFollowupsOrgSettings(args: {
  orgId: string;
  patch: Partial<Pick<FollowupsOrgSettings, "autoEnabled" | "maxTasksPerInvocation" | "drainDelaySeconds">>;
  log?: Logger;
}): Promise<FollowupsOrgSettings> {
  const current = await getFollowupsOrgSettings(args.orgId, args.log);
  const next: FollowupsOrgSettings = {
    ...current,
    autoEnabled: typeof args.patch.autoEnabled === "boolean" ? args.patch.autoEnabled : current.autoEnabled,
    maxTasksPerInvocation:
      typeof args.patch.maxTasksPerInvocation === "number"
        ? clampInt(args.patch.maxTasksPerInvocation, current.maxTasksPerInvocation, 1, 25)
        : current.maxTasksPerInvocation,
    drainDelaySeconds:
      typeof args.patch.drainDelaySeconds === "number"
        ? clampInt(args.patch.drainDelaySeconds, current.drainDelaySeconds, 0, 3600)
        : current.drainDelaySeconds,
  };

  const ref = getAdminDb().collection(FOLLOWUPS_SETTINGS_COLLECTION).doc(args.orgId);
  const existing = await ref.get();

  await ref.set(
    {
      orgId: args.orgId,
      autoEnabled: next.autoEnabled,
      maxTasksPerInvocation: next.maxTasksPerInvocation,
      drainDelaySeconds: next.drainDelaySeconds,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists ? undefined : FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  args.log?.info("outreach.followups.settings.updated", {
    orgId: args.orgId,
    autoEnabled: next.autoEnabled,
    maxTasksPerInvocation: next.maxTasksPerInvocation,
    drainDelaySeconds: next.drainDelaySeconds,
  });

  return next;
}

