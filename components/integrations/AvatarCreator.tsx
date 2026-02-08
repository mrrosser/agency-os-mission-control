"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Video, Loader2, ExternalLink, Download } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";

type VideoStatus = 'idle' | 'creating' | 'processing' | 'completed' | 'failed';

export function AvatarCreator() {
    const { user } = useAuth();
    const { status: secretStatus } = useSecretsStatus();
    const [script, setScript] = useState("");
    const [status, setStatus] = useState<VideoStatus>('idle');
    const [videoId, setVideoId] = useState<string | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    const handleCreate = async () => {
        if (!script) {
            toast.error("Please enter a script");
            return;
        }

        const hasHeyGen = secretStatus.heyGenKey !== "missing";

        if (!hasHeyGen) {
            toast.error("HeyGen API key not configured", {
                description: "Go to API Vault to add your HeyGen key"
            });
            return;
        }

        if (!user) {
            toast.error("You must be logged in to create avatars");
            return;
        }

        setStatus('creating');
        setProgress(10);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const response = await fetch('/api/heygen/create-avatar', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    script: script
                })
            });

            const result = await readApiJson<{ success?: boolean; videoId?: string; error?: string }>(response);

            if (response.ok && result.success && result.videoId) {
                setVideoId(result.videoId);
                setStatus('processing');
                setProgress(30);

                toast.success("Avatar video generation started", {
                    description: "This may take 2-5 minutes..."
                });

                // Start polling for status
                pollVideoStatus(result.videoId);
            } else {
                setStatus('failed');
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to create avatar (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: any) {
            console.error("Avatar creation error:", error);
            setStatus('failed');
            toast.error("Avatar creation failed", {
                description: error?.message || "Could not create avatar video"
            });
        }
    };

    const pollVideoStatus = async (vId: string) => {
        const maxAttempts = 60; // 10 minutes max (10s intervals)
        let attempts = 0;

        const checkStatus = async () => {
            try {
                if (!user) {
                    throw new Error("Not authenticated");
                }
                const headers = await buildAuthHeaders(user);
                const response = await fetch('/api/heygen/get-status', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        videoId: vId
                    })
                });

                const result = await readApiJson<{
                    success?: boolean;
                    status?: string;
                    videoUrl?: string;
                    error?: string;
                }>(response);

                if (response.ok && result.success) {
                    if (result.status === 'completed') {
                        setStatus('completed');
                        setVideoUrl(result.videoUrl || null);
                        setProgress(100);
                        toast.success("Avatar video ready!", {
                            description: "Your video has been generated successfully"
                        });
                        return;
                    } else if (result.status === 'failed') {
                        setStatus('failed');
                        toast.error("Video generation failed");
                        return;
                    }

                    // Still processing - update progress
                    const newProgress = Math.min(30 + (attempts * 1.5), 90);
                    setProgress(newProgress);
                }

                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(checkStatus, 10000); // Check every 10 seconds
                } else {
                    setStatus('failed');
                    toast.error("Video generation timeout", {
                        description: "Please check status manually"
                    });
                }
            } catch (error) {
                console.error("Status check error:", error);
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(checkStatus, 10000);
                }
            }
        };

        checkStatus();
    };

    const handleReset = () => {
        setStatus('idle');
        setVideoId(null);
        setVideoUrl(null);
        setProgress(0);
        setScript("");
    };

    return (
        <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="border-b border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                        <Video className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                        <CardTitle className="text-white">Avatar Creator</CardTitle>
                        <CardDescription className="text-zinc-400">
                            Generate personalized avatar videos with HeyGen
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                {/* Script Input */}
                <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-200">Video Script</Label>
                    <Textarea
                        placeholder="Type your video script here... Keep it under 90 seconds."
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        rows={8}
                        disabled={status === 'processing' || status === 'creating'}
                        className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 resize-none disabled:opacity-50"
                    />
                    <p className="text-xs text-zinc-500">{script.length} characters</p>
                </div>

                {/* Create Button */}
                {status === 'idle' && (
                    <Button
                        onClick={handleCreate}
                        disabled={!script}
                        className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-semibold"
                    >
                        <Video className="mr-2 h-4 w-4" />
                        Create Avatar Video
                    </Button>
                )}

                {/* Processing Status */}
                {(status === 'creating' || status === 'processing') && (
                    <div className="space-y-3 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                        <div className="flex items-center gap-2 text-sm text-zinc-300">
                            <Loader2 className="h-4 w-4 animate-spin text-green-500" />
                            <span>
                                {status === 'creating' ? 'Initializing...' : 'Processing video...'}
                            </span>
                        </div>
                        <Progress value={progress} className="h-2" />
                        <p className="text-xs text-zinc-500">
                            This typically takes 2-5 minutes. Please wait...
                        </p>
                    </div>
                )}

                {/* Completed */}
                {status === 'completed' && videoUrl && (
                    <div className="space-y-3">
                        <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
                            <p className="text-sm text-green-400 font-medium mb-2">✓ Video Ready!</p>
                            <div className="flex gap-2">
                                <Button
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                                >
                                    <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        Open Video
                                    </a>
                                </Button>
                                <Button
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                                >
                                    <a href={videoUrl} download>
                                        <Download className="mr-2 h-4 w-4" />
                                        Download
                                    </a>
                                </Button>
                            </div>
                        </div>

                        <Button
                            onClick={handleReset}
                            variant="outline"
                            className="w-full border-zinc-700 text-white hover:bg-zinc-800"
                        >
                            Create Another Video
                        </Button>
                    </div>
                )}

                {/* Failed */}
                {status === 'failed' && (
                    <div className="space-y-3">
                        <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                            <p className="text-sm text-red-400">Video generation failed. Please try again.</p>
                        </div>
                        <Button
                            onClick={handleReset}
                            variant="outline"
                            className="w-full border-zinc-700 text-white hover:bg-zinc-800"
                        >
                            Try Again
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
