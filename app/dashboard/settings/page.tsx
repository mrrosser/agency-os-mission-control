"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Save, Key, Building2, User, Loader2, CheckCircle2, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useSecretsStatus } from "@/lib/hooks/use-secrets-status";
import { AfroGlyph } from "@/components/branding/AfroGlyph";

interface IdentityProfile {
    businessName: string;
    founderName: string;
    website: string;
    primaryService: string;
    coreValue: string;
    keyBenefit: string;
    voiceProfiles?: Record<string, { voiceId?: string; modelId?: string }>;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type MotionSetting = "auto" | "on" | "off";

export default function SettingsPage() {
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [googleStatus, setGoogleStatus] = useState({
        connected: false,
        loading: true,
        capabilities: { drive: false, gmail: false, calendar: false },
    });
    const { status: secretStatus, loading: secretsLoading, refresh: refreshSecrets } = useSecretsStatus();
    const [activeTab, setActiveTab] = useState("identity");
    const [motionSetting, setMotionSetting] = useState<MotionSetting>("auto");

    const googleError = searchParams.get("google") === "error";
    const googleErrorCode = searchParams.get("googleError");
    const googleErrorDescription = searchParams.get("googleErrorDescription");

    // Identity State
    const [identity, setIdentity] = useState<IdentityProfile>({
        businessName: "",
        founderName: "",
        website: "",
        primaryService: "",
        coreValue: "",
        keyBenefit: "",
        voiceProfiles: {},
    });

    // ElevenLabs voice profiles (non-secret). Stored in Firestore under identities/{uid}.voiceProfiles
    const [voiceProfiles, setVoiceProfiles] = useState({
        aicfVoiceId: "",
        aicfModelId: "",
        rngVoiceId: "",
        rngModelId: "",
        rtsVoiceId: "",
        rtsModelId: "",
        defaultVoiceId: "",
        defaultModelId: "",
    });

    // API Keys State
    const [apiKeys, setApiKeys] = useState({
        openaiKey: "",
        twilioSid: "",
        twilioToken: "",
        twilioPhoneNumber: "",
        elevenLabsKey: "",
        heyGenKey: "",
        googlePlacesKey: "",
        firecrawlKey: "",
        googlePickerApiKey: "",
    });

    useEffect(() => {
        if (!user) return;

        const loadData = async () => {
            try {
                // Load Identity
                const identityDoc = await getDoc(doc(db, "identities", user.uid));
                if (identityDoc.exists()) {
                    const data = identityDoc.data() as Partial<IdentityProfile>;
                    setIdentity((prev) => ({ ...prev, ...data }));

                    // Load voice profiles (non-secret). Keep UI state normalized.
                    const profiles = (data.voiceProfiles || {}) as Record<
                        string,
                        { voiceId?: string; modelId?: string }
                    >;
                    setVoiceProfiles({
                        aicfVoiceId: String(profiles.aicf?.voiceId || ""),
                        aicfModelId: String(profiles.aicf?.modelId || ""),
                        rngVoiceId: String(profiles.rng?.voiceId || ""),
                        rngModelId: String(profiles.rng?.modelId || ""),
                        rtsVoiceId: String(profiles.rts?.voiceId || ""),
                        rtsModelId: String(profiles.rts?.modelId || ""),
                        defaultVoiceId: String(profiles.default?.voiceId || ""),
                        defaultModelId: String(profiles.default?.modelId || ""),
                    });
                }

                // Check Google Status
                const headers = await buildAuthHeaders(user);
                const res = await fetch("/api/google/status", { headers });
                const status = await readApiJson<{
                    connected?: boolean;
                    capabilities?: { drive?: boolean; gmail?: boolean; calendar?: boolean };
                    error?: string;
                }>(res);
                if (!res.ok) {
                    throw new Error(status?.error || "Failed to check Google connection");
                }
                setGoogleStatus({
                    connected: Boolean(status?.connected),
                    loading: false,
                    capabilities: {
                        drive: Boolean(status?.capabilities?.drive),
                        gmail: Boolean(status?.capabilities?.gmail),
                        calendar: Boolean(status?.capabilities?.calendar),
                    },
                });
            } catch (e) {
                console.error("Error loading settings", e);
                setGoogleStatus(prev => ({ ...prev, loading: false }));
            }
        };

        loadData();
    }, [user]);

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (tab === "integrations" || tab === "identity" || tab === "appearance") {
            setActiveTab(tab);
        }
    }, [searchParams]);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem("mission_control.motion");
            if (stored === "auto" || stored === "on" || stored === "off") {
                setMotionSetting(stored);
            }
        } catch {
            // ignore (storage disabled)
        }
    }, []);

    const handleMotionSettingChange = (value: string) => {
        if (value !== "auto" && value !== "on" && value !== "off") return;
        setMotionSetting(value);
        try {
            window.localStorage.setItem("mission_control.motion", value);
        } catch {
            // ignore (storage disabled)
        }
        toast.success("Appearance updated", {
            description: "Motion preference saved for this browser.",
        });
    };

    const handleConnectGoogle = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const headers = await buildAuthHeaders(user);
            const res = await fetch("/api/google/connect", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    returnTo: `${window.location.pathname}${window.location.search}`,
                    scopePreset: "core",
                })
            });
            const payload = await readApiJson<{ authUrl?: string; error?: string }>(res);
            if (!res.ok) {
                const cid = getResponseCorrelationId(res);
                throw new Error(payload?.error || `Failed to start Google connection${cid ? ` cid=${cid}` : ""}`);
            }
            const { authUrl } = payload;
            if (authUrl) window.location.href = authUrl;
        } catch (e: unknown) {
            toast.error("Failed to start Google connection", {
                description: getErrorMessage(e),
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
            setGoogleStatus({
                connected: false,
                loading: false,
                capabilities: { drive: false, gmail: false, calendar: false },
            });
            toast.success("Google account disconnected");
        } catch (e: unknown) {
            toast.error("Failed to disconnect", {
                description: getErrorMessage(e),
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
        } catch (e: unknown) {
            console.error("Failed to update identity", e);
            toast.error("Failed to update identity", {
                description: getErrorMessage(e),
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveVoiceProfiles = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const payload = {
                voiceProfiles: {
                    aicf: {
                        voiceId: voiceProfiles.aicfVoiceId.trim() || undefined,
                        modelId: voiceProfiles.aicfModelId.trim() || undefined,
                    },
                    rng: {
                        voiceId: voiceProfiles.rngVoiceId.trim() || undefined,
                        modelId: voiceProfiles.rngModelId.trim() || undefined,
                    },
                    rts: {
                        voiceId: voiceProfiles.rtsVoiceId.trim() || undefined,
                        modelId: voiceProfiles.rtsModelId.trim() || undefined,
                    },
                    default: {
                        voiceId: voiceProfiles.defaultVoiceId.trim() || undefined,
                        modelId: voiceProfiles.defaultModelId.trim() || undefined,
                    },
                },
            };

            await setDoc(doc(db, "identities", user.uid), payload, { merge: true });
            toast.success("Voice profiles saved");
        } catch (e: unknown) {
            toast.error("Failed to save voice profiles", {
                description: getErrorMessage(e),
            });
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
                twilioPhoneNumber: "",
                elevenLabsKey: "",
                heyGenKey: "",
                googlePlacesKey: "",
                firecrawlKey: "",
                googlePickerApiKey: "",
            });
            await refreshSecrets();
            toast.success("API keys saved securely in Secret Manager");
        } catch (e: unknown) {
            console.error("Failed to save API keys", e);
            toast.error("Failed to save API keys", {
                description: getErrorMessage(e),
            });
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

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="bg-zinc-900 border-zinc-800">
                        <TabsTrigger value="identity">Business Identity</TabsTrigger>
                        <TabsTrigger value="integrations">API Access</TabsTrigger>
                        <TabsTrigger value="appearance">Appearance</TabsTrigger>
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
                                            <div className="p-2 rounded-full bg-cyan-500/10 text-cyan-300">
                                                <AfroGlyph variant="integrations" className="h-5 w-5" />
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

                                    {googleError && (
                                        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                            <p className="font-medium">Google connection was denied.</p>
                                            <p className="mt-1 text-red-200/80">
                                                {googleErrorCode ? `Code: ${googleErrorCode}. ` : ""}
                                                {googleErrorDescription || "If you are using a managed Google Workspace account, your admin may block unverified apps until this OAuth consent screen is verified."}
                                            </p>
                                        </div>
                                    )}

                                    {googleStatus.connected && (
                                        <div className="flex flex-wrap gap-2 text-xs">
                                            <span
                                                className={`rounded-full border px-2 py-1 ${googleStatus.capabilities.drive
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                                                    }`}
                                            >
                                                Drive {googleStatus.capabilities.drive ? "enabled" : "missing"}
                                            </span>
                                            <span
                                                className={`rounded-full border px-2 py-1 ${googleStatus.capabilities.calendar
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                                                    }`}
                                            >
                                                Calendar {googleStatus.capabilities.calendar ? "enabled" : "missing"}
                                            </span>
                                            <span
                                                className={`rounded-full border px-2 py-1 ${googleStatus.capabilities.gmail
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                                                    }`}
                                            >
                                                Gmail {googleStatus.capabilities.gmail ? "enabled" : "missing"}
                                            </span>
                                        </div>
                                    )}

                                    {googleStatus.connected && !googleStatus.capabilities.gmail && (
                                        <p className="text-xs text-zinc-500">
                                            Gmail permissions are not enabled yet. Open the Integrations page to enable Gmail when you&apos;re ready.
                                        </p>
                                    )}

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
                                <div className="space-y-4">
                                    <Label className="flex justify-between">
                                        Google Picker API Key
                                        {renderSecretBadge(secretStatus.googlePickerApiKey)}
                                    </Label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                        <Input
                                            type="password"
                                            className="pl-9 bg-zinc-900 border-zinc-700"
                                            placeholder="AIza..."
                                            value={apiKeys.googlePickerApiKey}
                                            onChange={e => setApiKeys({ ...apiKeys, googlePickerApiKey: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-xs text-zinc-500">
                                        Required for the Drive &quot;Browse Drive&quot; picker UI in Operations Knowledge Base.
                                        Create a browser API key restricted to your app origin (for example
                                        <span className="text-zinc-300"> https://leadflow-review.web.app/*</span> and
                                        <span className="text-zinc-300"> http://localhost:3000/*</span>).
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
                                <p className="text-xs text-zinc-500">
                                    Twilio values come from your Twilio Console account dashboard: Account SID (starts with
                                    AC), Auth Token, and your purchased/verified Twilio number in E.164 format.
                                </p>
                                <div className="space-y-2">
                                    <Label className="flex justify-between">
                                        Twilio Phone Number (E.164)
                                        {renderSecretBadge(secretStatus.twilioPhoneNumber)}
                                    </Label>
                                    <Input
                                        className="bg-zinc-900 border-zinc-700"
                                        placeholder="+15005550006"
                                        value={apiKeys.twilioPhoneNumber}
                                        onChange={e => setApiKeys({ ...apiKeys, twilioPhoneNumber: e.target.value })}
                                    />
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
                                <p className="text-xs text-zinc-500">
                                    ElevenLabs API key comes from ElevenLabs settings. Keep keys in this vault only; do not
                                    paste them into chat or repo files.
                                </p>

                                <div className="space-y-3 p-4 rounded-lg bg-zinc-900/40 border border-zinc-800">
                                    <div>
                                        <p className="text-sm font-medium text-white">ElevenLabs Voice Profiles</p>
                                        <p className="text-xs text-zinc-500">
                                            Voice IDs are not secrets. These defaults are used for outbound calls when a business workspace is selected.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">AICF Voice ID</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                                                value={voiceProfiles.aicfVoiceId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, aicfVoiceId: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">AICF Model ID (optional)</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="e.g. eleven_turbo_v2_5"
                                                value={voiceProfiles.aicfModelId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, aicfModelId: e.target.value }))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">RNG Voice ID</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Voice ID"
                                                value={voiceProfiles.rngVoiceId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, rngVoiceId: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">RNG Model ID (optional)</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Model ID"
                                                value={voiceProfiles.rngModelId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, rngModelId: e.target.value }))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">RTS Voice ID</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Voice ID"
                                                value={voiceProfiles.rtsVoiceId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, rtsVoiceId: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">RTS Model ID (optional)</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Model ID"
                                                value={voiceProfiles.rtsModelId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, rtsModelId: e.target.value }))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">Default Voice ID (fallback)</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Voice ID"
                                                value={voiceProfiles.defaultVoiceId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, defaultVoiceId: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-zinc-300">Default Model ID (optional)</Label>
                                            <Input
                                                className="bg-zinc-900 border-zinc-700"
                                                placeholder="Model ID"
                                                value={voiceProfiles.defaultModelId}
                                                onChange={(e) =>
                                                    setVoiceProfiles((prev) => ({ ...prev, defaultModelId: e.target.value }))
                                                }
                                            />
                                        </div>
                                    </div>

                                    <Button
                                        onClick={handleSaveVoiceProfiles}
                                        disabled={loading}
                                        className="w-full bg-zinc-100 text-black hover:bg-zinc-200"
                                    >
                                        <Save className="mr-2 h-4 w-4" />
                                        Save Voice Profiles
                                    </Button>
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

                    {/* --- Appearance Tab --- */}
                    <TabsContent value="appearance">
                        <Card className="bg-zinc-950 border-zinc-800">
                            <CardHeader>
                                <CardTitle>Visual Effects</CardTitle>
                                <CardDescription>
                                    Control motion and animations. OS Reduce Motion is always respected.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Animated backgrounds</Label>
                                    <Select value={motionSetting} onValueChange={handleMotionSettingChange}>
                                        <SelectTrigger className="bg-zinc-900 border-zinc-700">
                                            <SelectValue placeholder="Auto (recommended)" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-zinc-950 border-zinc-800 text-white">
                                            <SelectItem value="auto">Auto (recommended)</SelectItem>
                                            <SelectItem value="on">On</SelectItem>
                                            <SelectItem value="off">Off</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-zinc-500">
                                        Applies to the login and landing visuals in this browser via localStorage.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div >
    );
}
