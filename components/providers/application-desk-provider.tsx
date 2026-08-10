"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import {
  normalizeApplicationDeskWorkspaces,
  type ApplicationDeskWorkspace,
} from "@/lib/application-desk";

interface ApplicationDeskWorkspaceContextValue {
  loading: boolean;
  error: string | null;
  workspaces: ApplicationDeskWorkspace[];
  refresh: () => Promise<void>;
}

const ApplicationDeskWorkspaceContext =
  createContext<ApplicationDeskWorkspaceContextValue>({
    loading: true,
    error: null,
    workspaces: [],
    refresh: async () => undefined,
  });

export function ApplicationDeskWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<ApplicationDeskWorkspace[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/application-desk/workspaces", {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const payload = await readApiJson<{ workspaces?: unknown }>(response);
      if (!response.ok) {
        throw new Error(
          String((payload as { error?: string }).error || "Unable to load application workspaces."),
        );
      }
      setWorkspaces(normalizeApplicationDeskWorkspaces(payload.workspaces));
    } catch (loadError) {
      setWorkspaces([]);
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load application workspaces.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ loading, error, workspaces, refresh }),
    [error, loading, refresh, workspaces],
  );

  return (
    <ApplicationDeskWorkspaceContext.Provider value={value}>
      {children}
    </ApplicationDeskWorkspaceContext.Provider>
  );
}

export function useApplicationDeskWorkspaces() {
  return useContext(ApplicationDeskWorkspaceContext);
}
