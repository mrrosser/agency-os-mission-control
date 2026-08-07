"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard.route_error", {
      correlationId: error.digest || "client-route-error",
      name: error.name,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-[#05060b] p-6 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-rose-400/30 bg-rose-950/20 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-300" />
        <h1 className="mt-4 text-xl font-semibold">This view hit a temporary problem</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your work is still saved. Retry the view; if it repeats, include the reference below when reporting it.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-zinc-500">Reference: {error.digest || "client-route-error"}</p>
        <Button onClick={reset} className="mt-5 min-h-11 bg-white text-black hover:bg-zinc-200">
          <RotateCcw className="mr-2 h-4 w-4" /> Retry view
        </Button>
      </div>
    </main>
  );
}
