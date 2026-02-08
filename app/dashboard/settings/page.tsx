"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Save, Key, Building2, User, Loader2, CheckCircle2, Mail, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";

export default function SettingsPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [googleStatus, setGoogleStatus] = useState({ connected: false, loading: true });
    const { status: secretStatus, loading: secretsLoading, refresh: refreshSecrets } = useSecretsStatus();

    // Identity State
    const [identity, setIdentity] = useState({
        businessName: "",
        founderName: "",
        website: "",
        primaryService: "",
        coreValue: "",
        keyBenefit: ""
    });

    // API Keys State
    const [apiKeys, setApiKeys] = useState({
        openaiKey: "",
        twilioSid: "",
        twilioToken: "",
        elevenLabsKey: "",
        heyGenKey: "",
        googlePlacesKey: "",
        firecrawlKey: "",
    });

    useEffect(() => {
        if (!user) return;

        const loadData = async () => {
            try {
                // Load Identity
                const identityDoc = await getDoc(doc(db, "identities", user.uid));
                if (identityDoc.exists()) {
                    setIdentity(identityDoc.data() as any);
                }

                // Check Google Status
                const headers = await buildAuthHeaders(user);
                const res = await fetch("/api/google/status", { headers });
                const status = await readApiJson<{ connected?: boolean; error?: string }>(res);
                if (!res.ok) {
                    throw new Error(status?.error || "Failed to check Google connection");
                }
                setGoogleStatus({ connected: Boolean(status?.connected), loading: false });
            } catch (e) {
                console.error("Error loading settings", e);
                setGoogleStatus(prev => ({ ...prev, loading: false }));
            }
        };

        loadData();
    }, [user]);

    const handleConnectGoogle = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/google/connect", {
                method: "POST",
                headers,
                body: JSON.stringify({ returnTo: window.location.pathname })
            });
            const payload = await readApiJson<{ authUrl?: string; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(payload?.error || `Failed to start Google connection${cid ? ` cid=${cid}` : ""}`);
            }
            const { authUrl } = payload;
            if (authUrl) window.location.href = authUrl;
        } catch (e) {
            toast.error("Failed to start Google connection", {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                description: (e as any)?.message || String(e),
            });
        }
        setLoading(false);
    };

    const handleDisconnectGoogle = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/google/disconnect", { method: "POST", headers });
            if (!res.ok) {
                const payload = await readApiJson<{ error?: string }>(res);
                throw new Error(payload?.error || "Failed to disconnect");
            }
            setGoogleStatus({ connected: false, loading: false });
            toast.success("Google account disconnected");
        } catch (e) {
            toast.error("Failed to disconnect", {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                description: (e as any)?.message || String(e),
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveIdentity = async () => {
        if (!user) return;
        setLoading(true);
        try {
            await setDoc(doc(db, "identities", user.uid), identity, { merge: true });
            toast.success("Identity updated successfully");
        } catch (e) {
            toast.error("Failed to update identity");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveKeys = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const payload: Record<string, string> = {};
            Object.entries(apiKeys).forEach(([key, value]) => {
                if (typeof value === "string" && value.trim().length > 0) {
                    payload[key] = value.trim();
                }
            });

            if (Object.keys(payload).length === 0) {
                toast.error("Enter at least one API key to save");
                return;
            }

            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });
            const response = await fetch("/api/secrets", {
                method: "POST",
                headers,
                body: JSON.stringify({ apiKeys: payload }),
            });
            const result = await readApiJson<{ error?: string }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                throw new Error(result?.error || `Failed to save API keys${cid ? ` cid=${cid}` : ""}`);
            }

            setApiKeys({
                openaiKey: "",
                twilioSid: "",
                twilioToken: "",
                elevenLabsKey: "",
                heyGenKey: "",
                googlePlacesKey: "",
                firecrawlKey: "",
            });
            await refreshSecrets();
            toast.success("API keys saved securely in Secret Manager");
        } catch (e) {
            toast.error("Failed to save API keys");
        } finally {
            setLoading(false);
        }
    };

    const renderSecretBadge = (status: "secret" | "env" | "missing") => {
        if (secretsLoading) {
            return (
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-500">
                    Checking...
                </Badge>
            );
        }

        if (status === "secret") {
            return (
                <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                </Badge>
            );
        }

        if (status === "env") {
            return (
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                    Env
                </Badge>
            );
        }

        return (
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-500">
                Not Configured
            </Badge>
        );
    };

    return (
        <div className="min-h-screen bg-black p-6 md:p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                <div>
                    <h1 className="text-3xl font-bold text-white">Settings</h1>
                    <p className="text-zinc-400">Manage your lead engine profile and outreach stack</p>
                </div>

                <Tabs defaultValue="identity" className="w-full">
                    <TabsList className="bg-zinc-900 border-zinc-800">
                        <TabsTrigger value="identity">Business Identity</TabsTrigger>
                        <TabsTrigger value="integrations">API Access</TabsTrigger>
                    </TabsList>

                    {/* --- Identity Tab --- */}
                    <TabsContent value="identity">
                        <Card className="bg-zinc-950 border-zinc-800">
                            <CardHeader>
                                <CardTitle>Lead Engine Profile</CardTitle>
                                <CardDescription>Used by AI to personalize lead outreach.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Business Name</Label>
                                        <div className="relative">
                                            <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                            <Input
                                                className="pl-9 bg-zinc-900 border-zinc-700"
                                                value={identity.businessName}
                                                onChange={e => setIdentity({ ...identity, businessName: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Founder Name</Label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                            <Input
                                                className="pl-9 bg-zinc-900 border-zinc-700"
                                                value={identity.founderName}
                                                onChange={e => setIdentity({ ...identity, founderName: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Primary Service</Label>
                                    <Input
                                        placeholder="e.g. High-performance Web Development"
                                        className="bg-zinc-900 border-zinc-700"
                                        value={identity.primaryService}
                                        onChange={e => setIdentity({ ...identity, primaryService: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Core Value Proposition</Label>
                                    <Input
                                        placeholder="e.g. We build websites that convert 3x better"
                                        className="bg-zinc-900 border-zinc-700"
                                        value={identity.coreValue}
                                        onChange={e => setIdentity({ ...identity, coreValue: e.target.value })}
                                    />
                                </div>
                                <Button onClick={handleSaveIdentity} disabled={loading} className="w-full">
                                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Profile
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* --- Integrations Tab --- */}
                    <TabsContent value="integrations">
                        <Card className="bg-zinc-950 border-zinc-800">
                            <CardHeader>
                                <CardTitle>Outreach API Configuration</CardTitle>
                                <CardDescription>Your keys are stored securely in Secret Manager.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Google Section */}
                                <div className="space-y-4 p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-full bg-red-500/10 text-red-500">
                                                <Mail className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-white">Google Workspace</p>
                                                <p className="text-sm text-zinc-400">Required for reading Drive files and sending emails.</p>
                                            </div>
                                        </div>
                                        {googleStatus.loading ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                                        ) : googleStatus.connected ? (
                                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                                                Connected
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-zinc-500">Disconnected</Badge>
                                        )}
                                    </div>
                                    {googleStatus.connected ? (
                                        <Button
                                            variant="outline"
                                            onClick={handleDisconnectGoogle}
                                            className="w-full border-zinc-800 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                        >
                                            <Power className="mr-2 h-4 w-4" /> Disconnect Account
                                        </Button>
                                    ) : (
                                        <Button
                                            onClick={handleConnectGoogle}
                                            className="w-full bg-white text-black hover:bg-zinc-200"
                                        >
                                            Connect Google Account
                                        </Button>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    <Label className="flex justify-between">
                                        OpenAI API Key
                                        {renderSecretBadge(secretStatus.openaiKey)}
                                    </Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            type="password"
                                            className="pl-9 bg-zinc-900 border-zinc-700"
                                            placeholder="sk-..."
                                            value={apiKeys.openaiKey}
                                            onChange={e => setApiKeys({ ...apiKeys, openaiKey: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <Label className="flex justify-between">
                                        Google Places API Key
                                        {renderSecretBadge(secretStatus.googlePlacesKey)}
                                    </Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            type="password"
                                            className="pl-9 bg-zinc-900 border-zinc-700"
                                            placeholder="AIza..."
                                            value={apiKeys.googlePlacesKey}
                                            onChange={e => setApiKeys({ ...apiKeys, googlePlacesKey: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Enables live lead sourcing from Google Places.
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    <Label className="flex justify-between">
                                        Firecrawl API Key
                                        {renderSecretBadge(secretStatus.firecrawlKey)}
                                    </Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            type="password"
                                            className="pl-9 bg-zinc-900 border-zinc-700"
                                            placeholder="fc-..."
                                            value={apiKeys.firecrawlKey}
                                            onChange={e => setApiKeys({ ...apiKeys, firecrawlKey: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Enables website enrichment (emails/signals) during lead sourcing.
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="flex justify-between">
                                            Twilio SID
                                            {renderSecretBadge(secretStatus.twilioSid)}
                                        </Label>
                                        <Input
                                            className="bg-zinc-900 border-zinc-700"
                                            value={apiKeys.twilioSid}
                                            onChange={e => setApiKeys({ ...apiKeys, twilioSid: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="flex justify-between">
                                            Twilio Auth Token
                                            {renderSecretBadge(secretStatus.twilioToken)}
                                        </Label>
                                        <Input
                                            type="password"
                                            className="bg-zinc-900 border-zinc-700"
                                            value={apiKeys.twilioToken}
                                            onChange={e => setApiKeys({ ...apiKeys, twilioToken: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex justify-between">
                                        ElevenLabs API Key
                                        {renderSecretBadge(secretStatus.elevenLabsKey)}
                                    </Label>
                                    <Input
                                        type="password"
                                        className="bg-zinc-900 border-zinc-700"
                                        value={apiKeys.elevenLabsKey}
                                        onChange={e => setApiKeys({ ...apiKeys, elevenLabsKey: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="flex justify-between">
                                        HeyGen API Key
                                        {renderSecretBadge(secretStatus.heyGenKey)}
                                    </Label>
                                    <Input
                                        type="password"
                                        className="bg-zinc-900 border-zinc-700"
                                        value={apiKeys.heyGenKey}
                                        onChange={e => setApiKeys({ ...apiKeys, heyGenKey: e.target.value })}
                                    />
                                </div>
                                <Button onClick={handleSaveKeys} className="w-full bg-zinc-100 text-black hover:bg-zinc-200">
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Keys
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div >
    );
}
