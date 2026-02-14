"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SmsSender } from "@/components/integrations/SmsSender";
import { VoiceGenerator } from "@/components/integrations/VoiceGenerator";
import { AvatarCreator } from "@/components/integrations/AvatarCreator";
import { GoogleWorkspaceConnect } from "@/components/integrations/GoogleWorkspaceConnect";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AfroGlyph } from "@/components/branding/AfroGlyph";

export default function IntegrationsPage() {
    const searchParams = useSearchParams();
    const googleError = searchParams.get("google") === "error";
    const googleErrorCode = searchParams.get("googleError");
    const googleErrorDescription = searchParams.get("googleErrorDescription");

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                            <AfroGlyph variant="integrations" className="h-6 w-6 text-cyan-300" />
                        </div>
                        <h1 className="text-3xl font-bold text-white">Outreach Integrations</h1>
                    </div>
                    <p className="text-zinc-400">
                        Verify the channels your lead engine uses for outreach
                    </p>
                    <div className="pt-2">
                        <Link href="/dashboard/settings?tab=integrations">
                            <Button variant="outline" className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
                                Open API Vault
                            </Button>
                        </Link>
                    </div>
                </div>

                {googleError && (
                    <Card className="bg-red-500/5 border-red-500/20">
                        <CardContent className="p-4 text-sm text-red-200 space-y-2">
                            <p className="font-medium">Google connection was denied.</p>
                            <p className="text-xs text-red-200/80">
                                {googleErrorCode ? `Code: ${googleErrorCode}. ` : ""}
                                {googleErrorDescription || "If you are using a managed Google Workspace account, your admin may block unverified apps until this OAuth consent screen is verified."}
                            </p>
                            <p className="text-xs text-red-200/80">
                                Workarounds: try a personal Gmail account, ask your Workspace admin to allow the app, or wait for Google verification.
                            </p>
                        </CardContent>
                    </Card>
                )}

                <GoogleWorkspaceConnect />

                {/* Feature Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-blue-500/10">
                                <AfroGlyph variant="chat" className="h-5 w-5 text-blue-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">SMS</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Send SMS follow-ups to qualified leads
                        </p>
                    </div>

                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-purple-500/10">
                                <AfroGlyph variant="voice" className="h-5 w-5 text-purple-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">Voice</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Generate AI voice for outbound calls
                        </p>
                    </div>

                    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-green-500/10">
                                <AfroGlyph variant="video" className="h-5 w-5 text-green-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">Avatar</h3>
                        </div>
                        <p className="text-sm text-zinc-400">
                            Create personalized avatar videos for outreach
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
                    <h3 className="text-lg font-semibold text-white mb-3">Getting Started</h3>
                    <ol className="space-y-2 text-sm text-zinc-400 list-decimal list-inside">
                        <li>Configure your API keys in the <strong className="text-white">API Vault</strong></li>
                        <li>Test each integration using the components above</li>
                        <li>Check the browser console (F12) for detailed logs</li>
                        <li>Use these integrations in your Lead Engine runs</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
