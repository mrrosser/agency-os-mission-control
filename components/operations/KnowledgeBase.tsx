"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

export function KnowledgeBase() {
    const { user } = useAuth();
    const router = useRouter();
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [notConnected, setNotConnected] = useState(false);

    const fetchFiles = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setNotConnected(false);
        try {
            const headers = await buildAuthHeaders(user);
            const response = await fetch("/api/drive/list", {
                method: "POST",
                headers,
                body: JSON.stringify({ pageSize: 100 }),
            });

            if (response.status === 401 || response.status === 403) {
                setNotConnected(true);
                setFiles([]);
                return;
            }

            const result = await readApiJson<{ files?: DriveFile[]; error?: string }>(response);
            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                const baseMessage =
                    result?.error || `Failed to load Drive files (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
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
            console.error("Failed to fetch drive files", error);
            toast.error("Could not load Google Drive files", {
                description: error instanceof Error ? error.message : String(error),
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
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchFiles}
                        disabled={loading}
                        className="border-zinc-700 text-zinc-300 hover:text-white"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Drive"}
                    </Button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                    {files.length === 0 && !loading && (
                        <div className="text-center py-8 text-zinc-500 text-sm">
                            {notConnected ? (
                                <>
                                    <p>Google Drive is not connected.</p>
                                    <Button
                                        variant="link"
                                        onClick={() => router.push("/dashboard/integrations")}
                                        className="text-blue-500"
                                    >
                                        Go to Integrations
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

                    {files.map(file => (
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
