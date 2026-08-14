"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildGoogleOAuthCleanUrl,
  getGoogleOAuthCallbackFeedback,
  hasGoogleOAuthCallbackParams,
} from "@/components/integrations/google-oauth-callback-feedback";

interface GoogleOAuthCallbackFeedbackProps {
  display?: boolean;
}

export function GoogleOAuthCallbackFeedback({
  display = true,
}: GoogleOAuthCallbackFeedbackProps) {
  const searchParams = useSearchParams();
  const feedback = useMemo(
    () => getGoogleOAuthCallbackFeedback(searchParams),
    [searchParams]
  );

  useEffect(() => {
    if (!hasGoogleOAuthCallbackParams(searchParams)) return;
    window.history.replaceState(
      window.history.state,
      "",
      buildGoogleOAuthCleanUrl(new URL(window.location.href))
    );
  }, [searchParams]);

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
