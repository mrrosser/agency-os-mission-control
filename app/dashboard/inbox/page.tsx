"use client";

import { useState, useEffect } from "react";
import { InboxList } from "@/components/gmail/InboxList";
import { EmailDetail } from "@/components/gmail/EmailDetail";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { GmailMessage } from "@/lib/google/gmail";
import { RefreshCw, Inbox as InboxIcon, AlertCircle } from "lucide-react";
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

    const loadInbox = async () => {
        if (!user) return;
        setLoading(true);
        setNotConnected(false);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/gmail/inbox", {
                method: "POST",
                headers,
                body: JSON.stringify({ maxResults: 20 }),
            });

            if (res.status === 403 || res.status === 401) {
                setNotConnected(true);
                setLoading(false);
                return;
            }

            const data = await readApiJson<{ messages?: GmailMessage[]; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    data?.error ||
                    `Failed to load inbox (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
            setMessages(data.messages || []);
        } catch (error: any) {
            console.error(error);
            toast.error("Could not load inbox", {
                description: error.message
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadInbox();
    }, [user]);

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
                        <InboxIcon className="h-5 w-5" />
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
                        <InboxIcon className="h-16 w-16 mb-4 opacity-10" />
                        <p>Select an email to view details</p>
                    </div>
                )}
            </div>
        </div>
    );
}
