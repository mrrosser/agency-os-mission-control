"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, X, Loader2, Eye } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

interface EmailComposerProps {
    onClose?: () => void;
    defaultTo?: string;
    defaultSubject?: string;
}

export function EmailComposer({ onClose, defaultTo = "", defaultSubject = "" }: EmailComposerProps) {
    const { user } = useAuth();
    const [to, setTo] = useState(defaultTo);
    const [cc, setCc] = useState("");
    const [subject, setSubject] = useState(defaultSubject);
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showCc, setShowCc] = useState(false);

    const handleSend = async () => {
        if (!to || !subject || !body) {
            toast.error("Please fill in all required fields");
            return;
        }

        if (!user) {
            toast.error("You must be logged in to send emails");
            return;
        }

        setSending(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });

            const response = await fetch("/api/gmail/send", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    email: {
                        to: to.split(",").map(e => e.trim()),
                        cc: cc ? cc.split(",").map(e => e.trim()) : undefined,
                        subject,
                        body,
                        isHtml: true,
                    },
                }),
            });

            const result = await readApiJson<{ messageId?: string; error?: string }>(response);

            if (response.ok) {
                toast.success("Email sent successfully!", {
                    description: `Message ID: ${result.messageId}`,
                });

                // Reset form
                setTo("");
                setCc("");
                setSubject("");
                setBody("");

                if (onClose) onClose();
            } else {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to send email (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: any) {
            console.error("Send error:", error);
            toast.error("Failed to send email", {
                description: error.message,
            });
        } finally {
            setSending(false);
        }
    };

    return (
        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
            <CardHeader className="border-b border-zinc-800">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-white">Compose Email</CardTitle>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowPreview(!showPreview)}
                            className="text-zinc-400 hover:text-white"
                        >
                            <Eye className="h-4 w-4 mr-2" />
                            {showPreview ? "Edit" : "Preview"}
                        </Button>
                        {onClose && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                {!showPreview ? (
                    <>
                        <div className="space-y-2">
                            <Label className="text-zinc-200">To *</Label>
                            <Input
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                placeholder="recipient@example.com, another@example.com"
                                className="bg-zinc-900 border-zinc-700 text-white"
                            />
                            <p className="text-xs text-zinc-500">
                                Separate multiple emails with commas
                            </p>
                        </div>

                        {!showCc && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowCc(true)}
                                className="text-blue-400 hover:text-blue-300 px-0"
                            >
                                + Add CC
                            </Button>
                        )}

                        {showCc && (
                            <div className="space-y-2">
                                <Label className="text-zinc-200">CC</Label>
                                <Input
                                    value={cc}
                                    onChange={(e) => setCc(e.target.value)}
                                    placeholder="cc@example.com"
                                    className="bg-zinc-900 border-zinc-700 text-white"
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label className="text-zinc-200">Subject *</Label>
                            <Input
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Email subject"
                                className="bg-zinc-900 border-zinc-700 text-white"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-zinc-200">Message *</Label>
                            <Textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                placeholder="Write your email message here..."
                                className="bg-zinc-900 border-zinc-700 text-white min-h-[300px] font-mono text-sm"
                            />
                            <p className="text-xs text-zinc-500">
                                HTML is supported. Use standard HTML tags for formatting.
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="space-y-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500 w-16">To:</span>
                                <span className="text-sm text-white">{to || "(empty)"}</span>
                            </div>
                            {cc && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500 w-16">CC:</span>
                                    <span className="text-sm text-white">{cc}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500 w-16">Subject:</span>
                                <span className="text-sm text-white font-semibold">
                                    {subject || "(empty)"}
                                </span>
                            </div>
                        </div>
                        <div className="border-t border-zinc-800 pt-4">
                            <div
                                className="text-sm text-white prose prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ __html: body || "(empty)" }}
                            />
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                    <p className="text-xs text-zinc-500">
                        {to.split(",").filter((e) => e.trim()).length} recipient(s)
                    </p>
                    <Button
                        onClick={handleSend}
                        disabled={sending || !to || !subject || !body}
                        className="bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        {sending ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                Send Email
                            </>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
