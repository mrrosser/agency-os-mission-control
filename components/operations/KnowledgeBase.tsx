"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, HardDrive } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { toast } from "sonner";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";
import { useRouter } from "next/navigation";

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
}

declare global {
    interface Window {
        gapi?: {
            load: (name: string, options: { callback: () => void }) => void;
        };
        google?: {
            picker?: unknown;
        };
    }
}

function mergeFiles(existing: DriveFile[], incoming: DriveFile[]): DriveFile[] {
    const byId = new Map<string, DriveFile>();
    for (const file of existing) byId.set(file.id, file);
    for (const file of incoming) byId.set(file.id, file);
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadGoogleApiScript(): Promise<void> {
    if (typeof window === "undefined") return;
    if (window.gapi?.load) return;

    await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[src="https://apis.google.com/js/api.js"]');
        if (existing) {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject(new Error("Failed to load Google API script")));
            // If it already loaded, resolve immediately.
            if ((window as unknown as { gapi?: unknown }).gapi) resolve();
            return;
        }

        const script = document.createElement("script");
        script.src = "https://apis.google.com/js/api.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google API script"));
        document.head.appendChild(script);
    });
}

async function loadGooglePicker(): Promise<void> {
    await loadGoogleApiScript();
    if (!window.gapi?.load) {
        throw new Error("Google API client did not initialize");
    }

    await new Promise<void>((resolve) => {
        window.gapi?.load("picker", { callback: () => resolve() });
    });

    if (!window.google?.picker) {
        throw new Error("Google Picker failed to load");
    }
}

export function KnowledgeBase() {
    const { user } = useAuth();
    const router = useRouter();
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [notConnected, setNotConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");

    const fetchFiles = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setNotConnected(false);
        setLastError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/drive/list", {
                method: "POST",
                headers,
                body: JSON.stringify({ pageSize: 100 }),
            });

            const result = await readApiJson<{ files?: DriveFile[]; error?: string }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                const baseMessage =
                    result?.error || `Failed to load Drive files (status ${response.status})`;
                const message = `${baseMessage}${cid ? ` cid=${cid}` : ""}`;
                setLastError(message);

                // 403 can be "not connected" OR "insufficient scopes" OR "API disabled". Only treat explicit
                // "not connected" cases as disconnected so we don't mislead users.
                if (response.status === 401 || response.status === 403) {
                    const normalized = baseMessage.toLowerCase();
                    if (normalized.includes("not connected")) {
                        setNotConnected(true);
                    }
                }

                throw new Error(message);
            }
            if (result.files) {
                // Filter for documents
                const docs = result.files.filter((f) => {
                    const mimeType = f.mimeType || "";
                    return (
                        mimeType.includes("document") ||
                        mimeType.includes("text") ||
                        mimeType.includes("pdf")
                    );
                });
                setFiles(docs);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Failed to fetch drive files", error);
            setLastError(message);

            // Best-effort client telemetry for caught UI errors.
            try {
                window.__mcReportTelemetryError?.({
                    kind: "client",
                    message,
                    route: window.location.pathname,
                    meta: { source: "knowledge_base.fetch_files" },
                });
            } catch {
                // ignore
            }
            toast.error("Could not load Google Drive files", {
                description: message,
            });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        // Load selected IDs from local storage
        const saved = localStorage.getItem("mission_control_knowledge_base");
        if (saved) {
            setSelectedIds(JSON.parse(saved));
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const openPicker = useCallback(async () => {
        if (!user) return;
        setPickerLoading(true);
        setLastError(null);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/drive/picker-token", {
                method: "GET",
                headers,
            });

            const result = await readApiJson<{
                accessToken?: string;
                pickerApiKey?: string;
                appId?: string | null;
                origin?: string;
                error?: string;
            }>(response);

            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                const baseMessage =
                    result?.error || `Failed to initialize Drive Picker (status ${response.status})`;
                const message = `${baseMessage}${cid ? ` cid=${cid}` : ""}`;
                setLastError(message);

                if (response.status === 401 || response.status === 403) {
                    const normalized = baseMessage.toLowerCase();
                    if (normalized.includes("not connected")) {
                        setNotConnected(true);
                    }
                }

                throw new Error(message);
            }

            if (!result.accessToken || !result.pickerApiKey) {
                throw new Error("Drive Picker is missing required configuration");
            }

            await loadGooglePicker();
            const googleAny = window.google as unknown as Record<string, any> | undefined;
            const picker = googleAny?.picker;
            if (!picker) {
                throw new Error("Google Picker is unavailable");
            }

            const view = new picker.DocsView(picker.ViewId.DOCS);
            // Allow browsing folders, but do not allow selecting folders as KB sources.
            view.setIncludeFolders(true);

            const builder = new picker.PickerBuilder()
                .setOAuthToken(result.accessToken)
                .setDeveloperKey(result.pickerApiKey)
                .setOrigin(window.location.origin)
                .addView(view)
                .enableFeature(picker.Feature.MULTISELECT_ENABLED)
                .enableFeature(picker.Feature.SUPPORT_DRIVES)
                .enableFeature(picker.Feature.SUPPORT_TEAM_DRIVES)
                .setCallback((data: any) => {
                    try {
                        if (data.action !== picker.Action.PICKED) return;
                        const docs = (data.docs || data[picker.Response.DOCUMENTS] || []) as Array<Record<string, any>>;
                        const picked = docs
                            .map((doc) => ({
                                id: String(doc.id || ""),
                                name: String(doc.name || "Untitled"),
                                mimeType: String(doc.mimeType || "application/octet-stream"),
                                webViewLink: String(doc.url || ""),
                            }))
                            .filter((doc) => doc.id && doc.mimeType !== "application/vnd.google-apps.folder");

                        if (picked.length === 0) return;

                        setFiles((prev) => mergeFiles(prev, picked));
                        setSelectedIds((prev) => {
                            const existing = new Set(prev);
                            for (const doc of picked) existing.add(doc.id);
                            const next = Array.from(existing);
                            localStorage.setItem("mission_control_knowledge_base", JSON.stringify(next));
                            return next;
                        });

                        toast.success(`Added ${picked.length} file${picked.length === 1 ? "" : "s"} to Knowledge Base`);
                    } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        toast.error("Failed to add Drive selection", { description: message });
                    }
                });

            if (result.appId) {
                builder.setAppId(result.appId);
            }

            const pickerInstance = builder.build();
            pickerInstance.setVisible(true);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setLastError(message);
            console.error("Drive picker error", error);

            try {
                window.__mcReportTelemetryError?.({
                    kind: "client",
                    message,
                    route: window.location.pathname,
                    meta: { source: "knowledge_base.drive_picker" },
                });
            } catch {
                // ignore
            }

            toast.error("Could not open Google Drive Picker", {
                description: message,
            });
        } finally {
            setPickerLoading(false);
        }
    }, [user]);

    const toggleFile = (file: DriveFile) => {
        setSelectedIds(prev => {
            const newSelection = prev.includes(file.id)
                ? prev.filter(id => id !== file.id)
                : [...prev, file.id];

            // Save to local storage
            localStorage.setItem("mission_control_knowledge_base", JSON.stringify(newSelection));

            if (newSelection.includes(file.id)) {
                toast.success(`Added "${file.name}" to Knowledge Base`);
            }

            return newSelection;
        });
    };

    const filteredFiles = files.filter((file) => {
        const q = filter.trim().toLowerCase();
        if (!q) return true;
        return file.name.toLowerCase().includes(q);
    });

    return (
        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <HardDrive className="h-5 w-5 text-blue-500" />
                            Knowledge Base
                        </h3>
                        <p className="text-sm text-zinc-400">
                            Select documents to train your AI agents
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            onClick={openPicker}
                            disabled={pickerLoading || loading}
                            className="bg-blue-600 hover:bg-blue-500 text-white"
                        >
                            {pickerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Browse Drive"}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchFiles}
                            disabled={loading}
                            className="border-zinc-700 text-zinc-300 hover:text-white"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh List"}
                        </Button>
                    </div>
                </div>

                <div className="text-xs text-zinc-500">
                    Use <span className="text-zinc-300">Browse Drive</span> for Google-native folder browsing + search.
                </div>

                <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter the list by name..."
                    className="bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
                />

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                    {files.length === 0 && !loading && (
                        <div className="text-center py-8 text-zinc-500 text-sm">
                            {notConnected ? (
                                <>
                                    <p>Google Drive is not connected.</p>
                                    {lastError ? (
                                        <p className="mt-2 text-xs text-zinc-600">{lastError}</p>
                                    ) : null}
                                    <Button
                                        variant="link"
                                        onClick={() => router.push("/dashboard/integrations")}
                                        className="text-blue-500"
                                    >
                                        Go to Integrations
                                    </Button>
                                </>
                            ) : lastError ? (
                                <>
                                    <p>Could not load Drive files.</p>
                                    <p className="mt-2 text-xs text-zinc-600">{lastError}</p>
                                    <Button
                                        variant="link"
                                        onClick={() => router.push("/dashboard/integrations")}
                                        className="text-blue-500"
                                    >
                                        Check Integrations
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <p>No documents found.</p>
                                    <Button
                                        variant="link"
                                        onClick={fetchFiles}
                                        className="text-blue-500"
                                    >
                                        Refresh Drive
                                    </Button>
                                </>
                            )}
                        </div>
                    )}

                    {filteredFiles.map(file => (
                        <div
                            key={file.id}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-all ${selectedIds.includes(file.id)
                                    ? "bg-blue-500/10 border-blue-500/30"
                                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                                }`}
                        >
                            <div className="flex items-center gap-3 overflow-hidden">
                                <Checkbox
                                    checked={selectedIds.includes(file.id)}
                                    onCheckedChange={() => toggleFile(file)}
                                    className="data-[state=checked]:bg-blue-500 border-zinc-600"
                                />
                                <div className="truncate">
                                    <p className={`text-sm font-medium truncate ${selectedIds.includes(file.id) ? "text-blue-200" : "text-zinc-300"
                                        }`}>
                                        {file.name}
                                    </p>
                                    <p className="text-xs text-zinc-500 truncate">Google Drive Document</p>
                                </div>
                            </div>

                            {selectedIds.includes(file.id) && (
                                <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                            )}
                        </div>
                    ))}
                </div>

                {selectedIds.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800">
                        <p className="text-xs text-green-500 flex items-center gap-1.5">
                            <CheckCircle2 className="h-3 w-3" />
                            {selectedIds.length} source files active for AI context
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
