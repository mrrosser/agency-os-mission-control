"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, limit, getDocs, onSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import { CheckCircle2, Circle, RefreshCcw, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { db } from "@/lib/firebase";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { buildFirstScanTourSteps, firstIncompleteStepIndex, type FirstScanTourSignals } from "@/lib/onboarding/first-scan";

type GoogleStatusPayload = {
  connected?: boolean;
  capabilities?: { drive?: boolean; calendar?: boolean; gmail?: boolean };
  error?: string;
};

const FORCE_REPLAY_KEY = "mission_control.firstScanTour.force";

function emptySignals(): FirstScanTourSignals {
  return {
    hasIdentity: false,
    googleConnected: false,
    googleCapabilities: { drive: false, calendar: false, gmail: false },
    secretStatus: { googlePlacesKey: "missing", firecrawlKey: "missing" },
  };
}

function isTruthyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasIdentityDoc(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return isTruthyString(data.businessName) && isTruthyString(data.primaryService) && isTruthyString(data.coreValue);
}

export function FirstScanTour() {
  const { user } = useAuth();
  const router = useRouter();
  // Tour is mounted globally; avoid fetching secrets status unless we actually show the tour.
  const { status: secretStatus, refresh: refreshSecrets } = useSecretsStatus({ enabled: false });

  const [open, setOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [signals, setSignals] = useState<FirstScanTourSignals>(() => emptySignals());
  const [googleStatusLoading, setGoogleStatusLoading] = useState(false);

  const initializedRef = useRef(false);

  const steps = useMemo(() => {
    const merged: FirstScanTourSignals = {
      ...signals,
      secretStatus: {
        googlePlacesKey: secretStatus.googlePlacesKey,
        firecrawlKey: secretStatus.firecrawlKey,
      },
    };
    return buildFirstScanTourSteps(merged);
  }, [signals, secretStatus.googlePlacesKey, secretStatus.firecrawlKey]);

  const currentStep = steps[stepIndex] || steps[0];

  const refreshGoogleStatus = async () => {
    if (!user) return;
    setGoogleStatusLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const res = await fetch("/api/google/status", { method: "GET", headers });
      const payload = await readApiJson<GoogleStatusPayload>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to load Google status${cid ? ` cid=${cid}` : ""}`);
      }

      const caps = payload.capabilities || {};
      setSignals((prev) => ({
        ...prev,
        googleConnected: Boolean(payload.connected),
        googleCapabilities: {
          drive: Boolean(caps.drive),
          calendar: Boolean(caps.calendar),
          gmail: Boolean(caps.gmail),
        },
      }));
    } catch (_error: unknown) {
      // Keep tour usable even if status fails (verification / auth hiccups).
      setSignals((prev) => ({
        ...prev,
        googleConnected: false,
        googleCapabilities: { drive: false, calendar: false, gmail: false },
      }));
    } finally {
      setGoogleStatusLoading(false);
    }
  };

  const refreshIdentityStatus = async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "identities", user.uid));
      setSignals((prev) => ({
        ...prev,
        hasIdentity: snap.exists() ? hasIdentityDoc(snap.data() as Record<string, unknown>) : false,
      }));
    } catch {
      setSignals((prev) => ({ ...prev, hasIdentity: false }));
    }
  };

  const markTourState = async (mode: "dismissed" | "completed") => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          "onboarding.firstScanTourV1.version": 1,
          [`onboarding.firstScanTourV1.${mode}At`]: serverTimestamp(),
        } as Record<string, unknown>,
        { merge: true }
      );
    } catch (error: unknown) {
      toast.error("Could not update onboarding state", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  useEffect(() => {
    if (!user) {
      setOpen(false);
      setBooting(false);
      setSignals(emptySignals());
      return;
    }

    let unsubIdentity: (() => void) | null = null;

    const boot = async () => {
      setBooting(true);
      try {
        let forceReplay = false;
        try {
          forceReplay = window.localStorage.getItem(FORCE_REPLAY_KEY) === "true";
        } catch {
          forceReplay = false;
        }

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const onboarding = userSnap.exists()
          ? ((userSnap.data() as Record<string, unknown>)?.onboarding as Record<string, unknown> | undefined)
          : undefined;
        const tour = onboarding ? (onboarding.firstScanTourV1 as Record<string, unknown> | undefined) : undefined;
        const dismissedAt = tour?.dismissedAt;
        const completedAt = tour?.completedAt;
        if (!forceReplay && (dismissedAt || completedAt)) {
          setOpen(false);
          return;
        }

        // Avoid showing the tour to users who already have leads.
        const leadsSnap = await getDocs(
          query(collection(db, "leads"), where("userId", "==", user.uid), limit(1))
        );
        if (!forceReplay && !leadsSnap.empty) {
          setOpen(false);
          return;
        }

        // Subscribe to identity so the tour updates as the user fills it out.
        unsubIdentity = onSnapshot(doc(db, "identities", user.uid), (snap) => {
          setSignals((prev) => ({
            ...prev,
            hasIdentity: snap.exists() ? hasIdentityDoc(snap.data() as Record<string, unknown>) : false,
          }));
        });

        // Initial status hydration.
        await refreshSecrets();
        await refreshGoogleStatus();
        await refreshIdentityStatus();

        setOpen(true);
        if (forceReplay) {
          try {
            window.localStorage.removeItem(FORCE_REPLAY_KEY);
          } catch {
            // ignore
          }
        }
      } finally {
        setBooting(false);
      }
    };

    void boot();

    return () => {
      if (unsubIdentity) unsubIdentity();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    setStepIndex(firstIncompleteStepIndex(steps));
  }, [open, steps]);

  const handleRefresh = async () => {
    await refreshSecrets();
    await refreshGoogleStatus();
    await refreshIdentityStatus();
    toast.success("Tour status refreshed");
  };

  const handleGo = (href?: string) => {
    if (!href) return;
    router.push(href);
  };

  const handleDismiss = async () => {
    await markTourState("dismissed");
    setOpen(false);
  };

  const handleComplete = async () => {
    await markTourState("completed");
    setOpen(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-2xl" data-testid="first-scan-tour">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-white">First Scan Tour</DialogTitle>
              <DialogDescription className="text-zinc-400">
                A quick setup path so you can run your first lead scan without guessing.
              </DialogDescription>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-zinc-400 hover:text-white"
              onClick={() => void handleDismiss()}
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {booting ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
            Loading tour...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                  Step {stepIndex + 1} / {steps.length}
                </Badge>
                {googleStatusLoading && (
                  <Badge variant="secondary" className="bg-zinc-900 text-zinc-400">
                    refreshing...
                  </Badge>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                onClick={() => void handleRefresh()}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>

            <div className="grid gap-2">
              {steps.map((step, idx) => (
                <button
                  key={step.key}
                  type="button"
                  className={[
                    "flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                    idx === stepIndex ? "border-blue-500/40 bg-blue-500/10" : "border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/30",
                  ].join(" ")}
                  onClick={() => setStepIndex(idx)}
                >
                  <div className="flex items-start gap-3">
                    {step.done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 text-zinc-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{step.title}</p>
                      <p className="mt-1 text-xs text-zinc-500">{step.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={step.done ? "bg-emerald-500/15 text-emerald-200" : "bg-zinc-800 text-zinc-300"}>
                      {step.done ? "done" : "todo"}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>

            {currentStep ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{currentStep.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{currentStep.description}</p>
                  </div>
                  {currentStep.href && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                      onClick={() => handleGo(currentStep.href)}
                    >
                      {currentStep.ctaLabel || "Open"}
                    </Button>
                  )}
                </div>

                {currentStep.key === "api_keys" && (
                  <div className="mt-3 text-xs text-zinc-500">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-zinc-900 text-zinc-300">
                        Places: {secretStatus.googlePlacesKey}
                      </Badge>
                      <Badge className="bg-zinc-900 text-zinc-300">
                        Firecrawl: {secretStatus.firecrawlKey}
                      </Badge>
                    </div>
                  </div>
                )}

                {currentStep.key === "google" && (
                  <div className="mt-3 text-xs text-zinc-500">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-zinc-900 text-zinc-300">
                        connected: {signals.googleConnected ? "yes" : "no"}
                      </Badge>
                      <Badge className="bg-zinc-900 text-zinc-300">
                        drive: {signals.googleCapabilities.drive ? "yes" : "no"}
                      </Badge>
                      <Badge className="bg-zinc-900 text-zinc-300">
                        calendar: {signals.googleCapabilities.calendar ? "yes" : "no"}
                      </Badge>
                      <Badge className="bg-zinc-900 text-zinc-300">
                        gmail: {signals.googleCapabilities.gmail ? "yes" : "no"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      If Google Drive connect is blocked for external users, your OAuth consent screen likely needs verification.
                      The app still works for lead scans via Places while you complete verification.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                onClick={() => void handleDismiss()}
              >
                Remind me later
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
                  onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                  disabled={stepIndex === 0}
                >
                  Back
                </Button>
                {stepIndex < steps.length - 1 ? (
                  <Button
                    type="button"
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                    onClick={() => setStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white"
                    onClick={() => {
                      handleGo("/dashboard/operations");
                      void handleComplete();
                    }}
                  >
                    Start first scan
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
