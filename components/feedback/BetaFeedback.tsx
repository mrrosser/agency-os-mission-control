"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessageSquarePlus, X, Send, Loader2, Bug, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/providers/auth-provider";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";

export function BetaFeedback() {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<"bug" | "feature">("bug");
    const [feedback, setFeedback] = useState("");
    const [sending, setSending] = useState(false);

    const handleSubmit = async () => {
        if (!feedback.trim()) return;

        setSending(true);
        try {
            await addDoc(collection(db, "feedback"), {
                type,
                content: feedback,
                userId: user?.uid || "anonymous",
                email: user?.email || "anonymous",
                timestamp: new Date(),
                path: window.location.pathname,
                userAgent: navigator.userAgent
            });

            toast.success("Feedback received!", {
                description: "Thanks for helping us improve AgencyOS."
            });
            setFeedback("");
            setOpen(false);
        } catch (error) {
            console.error("Feedback error", error);
            toast.error("Could not send feedback");
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    className="fixed bottom-4 right-4 h-12 rounded-full shadow-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-white z-50 animate-in fade-in slide-in-from-bottom-5"
                >
                    <MessageSquarePlus className="mr-2 h-4 w-4 text-blue-500" />
                    Beta Feedback
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-950 border-zinc-800 text-white sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Send Feedback</DialogTitle>
                    <DialogDescription className="text-zinc-400">
                        Found a bug? Have a request? Let us know directly.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-4">
                    <div className="flex gap-2 p-1 bg-zinc-900 rounded-lg border border-zinc-800">
                        <button
                            onClick={() => setType("bug")}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${type === "bug"
                                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                    : "text-zinc-400 hover:text-white"
                                }`}
                        >
                            <Bug className="h-4 w-4" />
                            Report Bug
                        </button>
                        <button
                            onClick={() => setType("feature")}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${type === "feature"
                                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                    : "text-zinc-400 hover:text-white"
                                }`}
                        >
                            <Lightbulb className="h-4 w-4" />
                            Request Feature
                        </button>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-zinc-300">Your Message</Label>
                        <Textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder={type === "bug"
                                ? "Describe what happened and what you expected..."
                                : "Describe the feature and why it would be useful..."}
                            className="min-h-[120px] bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:ring-blue-500/20"
                        />
                    </div>

                    <Button
                        onClick={handleSubmit}
                        disabled={!feedback.trim() || sending}
                        className="w-full bg-white text-black hover:bg-zinc-200"
                    >
                        {sending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                Send Feedback
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
