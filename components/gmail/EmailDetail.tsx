"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Reply, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GmailMessage } from "@/lib/google/gmail";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

interface EmailDetailProps {
    message: GmailMessage;
    threadMessages?: GmailMessage[]; // For future full thread support
    onReplySent?: () => void;
}

export function EmailDetail({ message, onReplySent }: EmailDetailProps) {
    const { user } = useAuth();
    const [replying, setReplying] = useState(false);
    const [sending, setSending] = useState(false);
    const [replyBody, setReplyBody] = useState("");

    const headers = message.payload?.headers || [];
    const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
    const from = headers.find((h) => h.name === "From")?.value || "Unknown";
    const to = headers.find((h) => h.name === "To")?.value || "Unknown";
    const dateStr = message.internalDate ? parseInt(message.internalDate) : Date.now();

    const handleSendReply = async () => {
        if (!replyBody.trim() || !user) return;
        setSending(true);

        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/gmail/reply", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    messageId: message.id,
                    threadId: message.threadId,
                    replyBody: replyBody,
                    isHtml: false, // Simple text reply
                }),
            });

            if (!res.ok) {
                const err = await readApiJson<{ error?: string }>(res);
                const cid = getResponseCorrelationId(res);
                throw new Error(
                    err?.error ||
                    `Failed to send reply (status ${res.status}${cid ? ` cid=${cid}` : ""})`
                );
            }

            toast.success("Reply sent!");
            setReplyBody("");
            setReplying(false);
            onReplySent?.();
        } catch (error: any) {
            toast.error("Failed to send reply", { description: error.message });
        } finally {
            setSending(false);
        }
    };

    // Helper to safely decode base64 email body
    const getBody = () => {
        let bodyData = message.payload?.body?.data;

        // If not in main body, check parts
        if (!bodyData && message.payload?.parts) {
            const textPart = message.payload.parts.find(p => p.mimeType === "text/plain");
            const htmlPart = message.payload.parts.find(p => p.mimeType === "text/html");
            bodyData = (htmlPart || textPart)?.body?.data;
        }

        if (!bodyData) return message.snippet || "";

        try {
            // Replace URL-safe base64 chars
            const base64 = bodyData.replace(/-/g, '+').replace(/_/g, '/');
            return decodeURIComponent(escape(atob(base64)));
        } catch (e) {
            return message.snippet || "Error decoding message body.";
        }
    };

    const bodyContent = getBody();
    const isHtml = message.payload?.body?.data ? false : message.payload?.parts?.some(p => p.mimeType === 'text/html');

    return (
        <div className="flex flex-col h-full bg-zinc-950">
            {/* Header */}
            <div className="p-6 border-b border-zinc-800 space-y-4">
                <h2 className="text-xl font-bold text-white break-words">{subject}</h2>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-zinc-700">
                            <AvatarFallback className="bg-zinc-800 text-zinc-400">
                                {from.replace(/["<]/g, "").trim().charAt(0).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="text-sm font-medium text-white">{from}</p>
                            <p className="text-xs text-zinc-400">to {to}</p>
                        </div>
                    </div>
                    <span className="text-xs text-zinc-500">
                        {format(dateStr, "PPP p")}
                    </span>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-6">
                {isHtml ? (
                    <div
                        className="prose prose-invert prose-sm max-w-none text-zinc-300"
                        dangerouslySetInnerHTML={{ __html: bodyContent }}
                    />
                ) : (
                    <div className="whitespace-pre-wrap text-sm text-zinc-300 font-mono">
                        {bodyContent}
                    </div>
                )}
            </div>

            {/* Reply Action */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
                {!replying ? (
                    <Button
                        variant="outline"
                        className="w-full justify-start text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-800"
                        onClick={() => setReplying(true)}
                    >
                        <Reply className="mr-2 h-4 w-4" />
                        Reply...
                    </Button>
                ) : (
                    <div className="space-y-3 animate-in slide-in-from-bottom-2 fade-in duration-300">
                        <Textarea
                            autoFocus
                            placeholder="Type your reply..."
                            className="min-h-[120px] bg-black border-zinc-700 focus:border-blue-500 resize-none"
                            value={replyBody}
                            onChange={(e) => setReplyBody(e.target.value)}
                        />
                        <div className="flex items-center justify-end gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setReplying(false)}
                                disabled={sending}
                                className="text-zinc-400 hover:text-white"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleSendReply}
                                disabled={sending}
                                className="bg-blue-600 hover:bg-blue-500 text-white"
                            >
                                {sending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <Send className="h-4 w-4 mr-2" />
                                )}
                                Send Reply
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
