"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);

        // Best-effort telemetry capture; never throw from error handling.
        try {
            const reporter = (window as unknown as { __mcReportTelemetryError?: (input: any) => void })
                .__mcReportTelemetryError;
            reporter?.({
                kind: "react",
                name: error.name,
                message: error.message,
                stack: error.stack,
                route: window.location.pathname,
                meta: {
                    source: "react.errorboundary",
                    componentStack: errorInfo?.componentStack || null,
                },
            });
        } catch {
            // ignore
        }
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen items-center justify-center bg-black p-4 text-white">
                    <Card className="max-w-md border-zinc-800 bg-zinc-950 shadow-2xl">
                        <CardHeader className="text-center">
                            <div className="flex justify-center mb-4">
                                <div className="p-3 rounded-full bg-red-500/10 border border-red-500/20">
                                    <AlertTriangle className="w-8 h-8 text-red-500" />
                                </div>
                            </div>
                            <CardTitle className="text-xl">Mission System Interrupted</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-center">
                            <p className="text-sm text-zinc-400">
                                A critical error occurred in the Mission Control interface.
                                All active lead runs are still safe on the backend.
                            </p>
                            <Button
                                onClick={() => window.location.reload()}
                                className="w-full bg-white text-black hover:bg-zinc-200"
                            >
                                <RefreshCcw className="mr-2 h-4 w-4" />
                                Reload Mission Center
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
