"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MessageSquare, Send, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";

interface SentMessage {
    to: string;
    message: string;
    timestamp: Date;
    status: string;
}

export function SmsSender() {
    const { user } = useAuth();
    const { status: secretStatus } = useSecretsStatus();
    const [to, setTo] = useState("");
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [history, setHistory] = useState<SentMessage[]>([]);

    const maxChars = 160;
    const remainingChars = maxChars - message.length;

    const handleSend = async () => {
        if (!to || !message) {
            toast.error("Please fill in all fields");
            return;
        }

        // Validate phone number format (basic E.164 check)
        if (!to.startsWith("+")) {
            toast.error("Phone number must start with + (E.164 format)");
            return;
        }

        const hasTwilio =
            secretStatus.twilioSid !== "missing" &&
            secretStatus.twilioToken !== "missing";

        if (!hasTwilio) {
            toast.error("Twilio credentials not configured", {
                description: "Go to API Vault to add your Twilio SID and Auth Token"
            });
            return;
        }

        if (!user) {
            toast.error("You must be logged in to send SMS");
            return;
        }

        setSending(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const response = await fetch('/api/twilio/send-sms', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    to: to,
                    message: message,
                })
            });

            const result = await readApiJson<{
                success?: boolean;
                messageSid?: string;
                status?: string;
                error?: string;
            }>(response);

            if (response.ok && result.success) {
                toast.success("SMS Sent Successfully", {
                    description: `Message ID: ${result.messageSid}`,
                    icon: <CheckCircle2 className="h-4 w-4" />
                });

                // Add to history
                setHistory((prev) => [
                    {
                        to,
                        message,
                        timestamp: new Date(),
                        status: result.status || "sent",
                    },
                    ...prev.slice(0, 4), // Keep last 5
                ]);

                // Clear form
                setTo("");
                setMessage("");
            } else {
                const cid = getResponseCorrelationId(response);
                throw new Error(
                    result?.error ||
                    `Failed to send SMS (status ${response.status}${cid ? ` cid=${cid}` : ""})`
                );
            }
        } catch (error: any) {
            console.error("SMS error:", error);
            toast.error("Failed to send SMS", {
                description: error?.message || "Could not send message"
            });
        } finally {
            setSending(false);
        }
    };

    return (
        <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="border-b border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                        <MessageSquare className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                        <CardTitle className="text-white">SMS Sender</CardTitle>
                        <CardDescription className="text-zinc-400">
                            Send test SMS messages via Twilio
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                {/* Phone Input */}
                <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-200">To (E.164 Format)</Label>
                    <Input
                        placeholder="+15551234567"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                    <p className="text-xs text-zinc-500">Include country code (e.g., +1 for US)</p>
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-zinc-200">Message</Label>
                        <span className={`text-xs ${remainingChars < 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                            {remainingChars} / {maxChars} chars
                        </span>
                    </div>
                    <Textarea
                        placeholder="Type your message here..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={4}
                        className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-none"
                    />
                </div>

                {/* Send Button */}
                <Button
                    onClick={handleSend}
                    disabled={sending || !to || !message || remainingChars < 0}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                    {sending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="mr-2 h-4 w-4" />
                            Send SMS
                        </>
                    )}
                </Button>

                {/* Message History */}
                {history.length > 0 && (
                    <div className="pt-4 border-t border-zinc-800">
                        <h4 className="text-sm font-medium text-zinc-300 mb-3">Recent Messages</h4>
                        <div className="space-y-2">
                            {history.map((msg, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                    <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 text-zinc-400">
                                        <span className="text-zinc-300">Sent to {msg.to}</span>
                                        <span className="mx-1">·</span>
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
