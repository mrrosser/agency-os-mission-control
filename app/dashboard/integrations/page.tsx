"use client";

import { SmsSender } from "@/components/integrations/SmsSender";
import { VoiceGenerator } from "@/components/integrations/VoiceGenerator";
import { AvatarCreator } from "@/components/integrations/AvatarCreator";
import { GoogleWorkspaceConnect } from "@/components/integrations/GoogleWorkspaceConnect";
import { MessageSquare, Mic, Video } from "lucide-react";

export default function IntegrationsPage() {
    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold text-white">🧪 Integration Testing</h1>
                    <p className="text-zinc-400">
                        Test your Twilio, ElevenLabs, and HeyGen integrations
                    </p>
                </div>

                <GoogleWorkspaceConnect />

                {/* Feature Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-blue-500/10">
                                <MessageSquare className="h-5 w-5 text-blue-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">SMS</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Send text messages to leads via Twilio
                        </p>
                    </div>

                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-purple-500/10">
                                <Mic className="h-5 w-5 text-purple-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">Voice</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Generate AI voice audio with ElevenLabs
                        </p>
                    </div>

                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-green-500/10">
                                <Video className="h-5 w-5 text-green-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">Avatar</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Create personalized videos with HeyGen
                        </p>
                    </div>
                </div>

                {/* Components */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SmsSender />
                    <VoiceGenerator />
                </div>

                <div className="grid grid-cols-1">
                    <AvatarCreator />
                </div>

                {/* Instructions */}
                <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <h3 className="text-lg font-semibold text-white mb-3">📋 Getting Started</h3>
                    <ol className="space-y-2 text-sm text-zinc-400 list-decimal list-inside">
                        <li>Configure your API keys in the <strong className="text-white">API Vault</strong></li>
                        <li>Test each integration using the components above</li>
                        <li>Check the browser console (F12) for detailed logs</li>
                        <li>Use these integrations in your Operations campaigns</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
