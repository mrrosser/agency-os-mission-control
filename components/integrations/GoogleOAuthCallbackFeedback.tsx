"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildGoogleOAuthCleanUrl,
  getGoogleOAuthCallbackFeedback,
  hasGoogleOAuthCallbackParams,
} from "@/components/integrations/google-oauth-callback-feedback";

interface GoogleOAuthCallbackFeedbackProps {
  display?: boolean;
  onResult?: () => void;
}

export function GoogleOAuthCallbackFeedback(props: GoogleOAuthCallbackFeedbackProps) {
  const { user } = useAuth();
  // Wait for the authenticated owner before consuming callback metadata. A new
  // owner gets a new result instance, so retained success cannot cross sessions.
  return user ? <OwnerGoogleOAuthCallbackFeedback key={user.uid} {...props} /> : null;
}

function OwnerGoogleOAuthCallbackFeedback({
  display = true,
  onResult,
}: GoogleOAuthCallbackFeedbackProps) {
  const searchParams = useSearchParams();
  // Retain the safe result while removing callback metadata from the address bar.
  // Next's search-params snapshot can lag a replaceState. A new owner's mount
  // must read the actual address bar, never revive already-consumed metadata.
  const [feedback, setFeedback] = useState(() => getGoogleOAuthCallbackFeedback(
    typeof window === "undefined" ? searchParams : new URLSearchParams(window.location.search)
  ));

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    if (!hasGoogleOAuthCallbackParams(currentUrl.searchParams)) return;
    const currentFeedback = getGoogleOAuthCallbackFeedback(currentUrl.searchParams);
    if (currentFeedback) {
      setFeedback(currentFeedback);
      onResult?.();
    }
    window.history.replaceState(
      window.history.state,
      "",
      buildGoogleOAuthCleanUrl(currentUrl)
    );
  }, [onResult, searchParams]);

  if (!display || !feedback) return null;

  const success = feedback.kind === "success";
  return (
    <Card
      className={
        success
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-red-500/20 bg-red-500/5"
      }
      role="status"
      aria-live="polite"
    >
      <CardContent
        className={`space-y-2 p-4 text-sm ${success ? "text-emerald-100" : "text-red-200"}`}
      >
        <p className="font-medium">{feedback.title}</p>
        <p className={success ? "text-emerald-100/80" : "text-red-200/80"}>
          {feedback.description}
        </p>
        {feedback.supportId && (
          <p className="text-xs text-red-200/70">
            Support ID: <code>{feedback.supportId}</code>
          </p>
        )}
        {feedback.showHelpLink && (
          <div className="pt-1">
            <Button
              asChild
              variant="outline"
              className="border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/15"
            >
              <Link href="/help/google-oauth">
                Open connection checklist
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
