"use client";

import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { GmailMessage } from "@/lib/google/gmail";

interface InboxListProps {
    messages: GmailMessage[];
    selectedId?: string;
    onSelect: (message: GmailMessage) => void;
    loading: boolean;
}

export function InboxList({ messages, selectedId, onSelect, loading }: InboxListProps) {
    if (loading) {
        return (
            <div className="flex flex-col gap-2 p-4">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-zinc-900/50 animate-pulse" />
                ))}
            </div>
        );
    }

    if (messages.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-zinc-500">
                <AfroGlyph variant="inbox" className="h-12 w-12 mb-4 opacity-20" />
                <p>Your inbox is empty</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col divide-y divide-zinc-800">
            {messages.map((message) => {
                const headers = message.payload?.headers || [];
                const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
                const from = headers.find((h) => h.name === "From")?.value || "Unknown";
                const dateStr = message.internalDate
                    ? parseInt(message.internalDate)
                    : null;

                // Clean up "From" -> display name only if possible
                const fromName = from.split("<")[0].replace(/"/g, "").trim();

                return (
                    <button
                        key={message.id}
                        onClick={() => onSelect(message)}
                        className={cn(
                            "flex flex-col items-start gap-2 p-4 text-left transition-colors hover:bg-zinc-900",
                            selectedId === message.id ? "bg-blue-500/10 hover:bg-blue-500/15" : "bg-transparent"
                        )}
                    >
                        <div className="flex w-full items-start justify-between">
                            <span className={cn("font-semibold text-sm truncate max-w-[200px]", selectedId === message.id ? "text-blue-400" : "text-white")}>
                                {fromName}
                            </span>
                            {dateStr && (
                                <span className="text-xs text-zinc-500 whitespace-nowrap ml-2">
                                    {formatDistanceToNow(dateStr, { addSuffix: true })}
                                </span>
                            )}
                        </div>

                        <span className="text-sm font-medium text-zinc-300 line-clamp-1 w-full">
                            {subject}
                        </span>

                        <p className="text-xs text-zinc-500 line-clamp-2 w-full break-words">
                            {message.snippet}
                        </p>
                    </button>
                );
            })}
        </div>
    );
}
