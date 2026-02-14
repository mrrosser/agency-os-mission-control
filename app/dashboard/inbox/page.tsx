"use client";

import { useCallback, useEffect, useState } from "react";
import { InboxList } from "@/components/gmail/InboxList";
import { EmailDetail } from "@/components/gmail/EmailDetail";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { GmailMessage } from "@/lib/google/gmail";
import { RefreshCw, AlertCircle } from "lucide-react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function InboxPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [messages, setMessages] = useState<GmailMessage[]>([]);
    const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
    const [loading, setLoading] = useState(true);
    const [notConnected, setNotConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    const loadInbox = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setNotConnected(false);
        setLastError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/gmail/inbox", {
                method: "POST",
                headers,
                body: JSON.stringify({ maxResults: 20 }),
            });

            const data = await readApiJson<{ messages?: GmailMessage[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                const baseMessage = data?.error || `Failed to load inbox (status ${res.status})`;
                const message = `${baseMessage}${cid ? ` cid=${cid}` : ""}`;
                setLastError(message);

                if (res.status === 401 || res.status === 403) {
                    const normalized = baseMessage.toLowerCase();
                    if (normalized.includes("not connected")) {
                        setNotConnected(true);
                    }
                }

                throw new Error(message);
            }
            setMessages(data.messages || []);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(error);
            setLastError(message);

            // Best-effort client telemetry for caught UI errors.
            try {
                window.__mcReportTelemetryError?.({
                    kind: "client",
                    message,
                    route: window.location.pathname,
                    meta: { source: "inbox.load_inbox" },
                });
            } catch {
                // ignore
            }
            toast.error("Could not load inbox", {
                description: message,
            });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadInbox();
    }, [loadInbox]);

    // Show "Connect Google" prompt if not connected
    if (notConnected) {
        return (
            <div className="flex items-center justify-center h-screen bg-black p-6">
                <div className="max-w-md p-8 border border-zinc-800 rounded-lg bg-zinc-950 text-center">
                    <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Google Workspace Not Connected</h2>
                    <p className="text-zinc-400 mb-6">
                        To view your inbox, you need to connect your Google Workspace account first.
                    </p>
                    {lastError ? (
                        <p className="text-xs text-zinc-600 mb-4">{lastError}</p>
                    ) : null}
                    <Button
                        onClick={() => router.push("/dashboard/integrations")}
                        className="bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        Go to Integrations
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-black overflow-hidden">
            {/* Sidebar: Message List */}
            <div className="w-1/3 min-w-[300px] border-r border-zinc-800 flex flex-col bg-zinc-950">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                    <h1 className="text-lg font-bold text-white flex items-center gap-2">
                        <AfroGlyph variant="inbox" className="h-5 w-5 text-cyan-200" />
                        Inbox
                    </h1>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={loadInbox}
                        disabled={loading}
                        className="text-zinc-400 hover:text-white"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
                {lastError && !loading ? (
                    <div className="px-4 py-2 text-xs text-red-300 bg-red-950/30 border-b border-red-900/40">
                        {lastError}
                    </div>
                ) : null}
                <div className="flex-1 overflow-y-auto">
                    <InboxList
                        messages={messages}
                        loading={loading}
                        selectedId={selectedMessage?.id}
                        onSelect={setSelectedMessage}
                    />
                </div>
            </div>

            {/* Main Content: Email Detail */}
            <div className="flex-1 flex flex-col bg-black">
                {selectedMessage ? (
                    <EmailDetail
                        message={selectedMessage}
                        onReplySent={() => {
                            // Optionally reload or mark as read
                        }}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                        <AfroGlyph variant="inbox" className="h-16 w-16 mb-4 opacity-10" />
                        <p>Select an email to view details</p>
                    </div>
                )}
            </div>
        </div>
    );
}
