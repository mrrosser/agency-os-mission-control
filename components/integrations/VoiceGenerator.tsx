"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Mic, Loader2, Download, Play, Pause } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";

const VOICES = [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel - Professional Female" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Warm Female" },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam - Professional Male" },
    { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam - Conversational Male" },
];

export function VoiceGenerator() {
    const { user } = useAuth();
    const { status: secretStatus } = useSecretsStatus();
    const [text, setText] = useState("");
    const [voiceId, setVoiceId] = useState(VOICES[0].id);
    const [generating, setGenerating] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handleGenerate = async () => {
        if (!text) {
            toast.error("Please enter text to synthesize");
            return;
        }

        const hasElevenLabs = secretStatus.elevenLabsKey !== "missing";

        if (!hasElevenLabs) {
            toast.error("ElevenLabs API key not configured", {
                description: "Go to API Vault to add your ElevenLabs key"
            });
            return;
        }

        if (!user) {
            toast.error("You must be logged in to generate audio");
            return;
        }

        setGenerating(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const response = await fetch('/api/elevenlabs/synthesize', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    text: text,
                    voiceId: voiceId
                })
            });

            const result = await readApiJson<{
                success?: boolean;
                audioBase64?: string;
                error?: string;
            }>(response);

            if (response.ok && result.success && result.audioBase64) {
                // Convert base64 to blob
                const audioBlob = new Blob(
                    [Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0))],
                    { type: 'audio/mpeg' }
                );

                const url = URL.createObjectURL(audioBlob);
                setAudioUrl(url);

                toast.success("Voice Generated Successfully", {
                    description: "Audio is ready to play"
                });
            } else {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to generate voice (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: unknown) {
            console.error("Voice generation error:", error);
            toast.error("Voice generation failed", {
                description: error instanceof Error ? error.message : "Could not generate audio",
            });
        } finally {
            setGenerating(false);
        }
    };

    const handlePlayPause = () => {
        if (!audioRef.current || !audioUrl) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    const handleDownload = () => {
        if (!audioUrl) return;

        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = 'voice-message.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        toast.success("Download started");
    };

    return (
        <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader className="border-b border-zinc-800">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                        <Mic className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                        <CardTitle className="text-white">Voice Generator</CardTitle>
                        <CardDescription className="text-zinc-400">
                            Generate AI voice audio with ElevenLabs
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                {/* Voice Selection */}
                <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-200">Voice</Label>
                    <Select value={voiceId} onValueChange={setVoiceId}>
                        <SelectTrigger className="h-11 bg-zinc-900 border-zinc-700 text-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                            {VOICES.map(voice => (
                                <SelectItem key={voice.id} value={voice.id} className="text-white">
                                    {voice.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Text Input */}
                <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-200">Script</Label>
                    <Textarea
                        placeholder="Type the text you want to convert to speech..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={6}
                        className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 resize-none"
                    />
                    <p className="text-xs text-zinc-500">{text.length} characters</p>
                </div>

                {/* Generate Button */}
                <Button
                    onClick={handleGenerate}
                    disabled={generating || !text}
                    className="w-full h-11 bg-purple-600 hover:bg-purple-500 text-white font-semibold"
                >
                    {generating ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <Mic className="mr-2 h-4 w-4" />
                            Generate Voice
                        </>
                    )}
                </Button>

                {/* Audio Player */}
                {audioUrl && (
                    <div className="pt-4 border-t border-zinc-800 space-y-3">
                        <h4 className="text-sm font-medium text-zinc-300">Preview</h4>

                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handlePlayPause}
                                variant="outline"
                                size="sm"
                                className="border-zinc-700 text-white hover:bg-zinc-800"
                            >
                                {isPlaying ? (
                                    <Pause className="h-4 w-4" />
                                ) : (
                                    <Play className="h-4 w-4" />
                                )}
                            </Button>

                            <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-500" style={{ width: '0%' }} />
                            </div>

                            <Button
                                onClick={handleDownload}
                                variant="outline"
                                size="sm"
                                className="border-zinc-700 text-white hover:bg-zinc-800"
                            >
                                <Download className="h-4 w-4" />
                            </Button>
                        </div>

                        <audio
                            ref={audioRef}
                            src={audioUrl}
                            onEnded={() => setIsPlaying(false)}
                            className="hidden"
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
