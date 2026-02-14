"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

export type SecretKey =
  | "openaiKey"
  | "twilioSid"
  | "twilioToken"
  | "twilioPhoneNumber"
  | "elevenLabsKey"
  | "heyGenKey"
  | "googlePlacesKey"
  | "firecrawlKey"
  | "googlePickerApiKey";

export type SecretStatus = Record<SecretKey, "secret" | "env" | "missing">;

const EMPTY_STATUS: SecretStatus = {
  openaiKey: "missing",
  twilioSid: "missing",
  twilioToken: "missing",
  twilioPhoneNumber: "missing",
  elevenLabsKey: "missing",
  heyGenKey: "missing",
  googlePlacesKey: "missing",
  firecrawlKey: "missing",
  googlePickerApiKey: "missing",
};

export function useSecretsStatus(options?: { enabled?: boolean }) {
  // Default behavior (enabled): fetch on mount and whenever the authenticated user changes.
  // Some flows (e.g. onboarding tours mounted globally) may opt out of the auto-fetch and
  // call `refresh()` only when the UI is actually shown.
  const { user } = useAuth();
  const enabled = options?.enabled ?? true;
  const [status, setStatus] = useState<SecretStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(EMPTY_STATUS);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/secrets", { headers });
      const payload = await readApiJson<{ status?: SecretStatus; error?: string }>(response);
      if (!response.ok) {
        const cid = getResponseCorrelationId(response);
        throw new Error(payload?.error || `Failed to load secrets status${cid ? ` cid=${cid}` : ""}`);
      }
      setStatus(payload.status || EMPTY_STATUS);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load secrets status");
      setStatus(EMPTY_STATUS);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  return { status, loading, error, refresh };
}
