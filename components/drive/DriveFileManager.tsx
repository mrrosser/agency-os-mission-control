"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
    Folder,
    File,
    Upload,
    Loader2,
    FolderPlus,
    ExternalLink,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

interface DriveFile {
    id?: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
}

export function DriveFileManager() {
    const { user } = useAuth();
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [showCreateFolder, setShowCreateFolder] = useState(false);

    const loadFiles = useCallback(async () => {
        if (!user) return;

        setLoading(true);
        try {
            const headers = await buildAuthHeaders(user);

            const response = await fetch("/api/drive/list", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    pageSize: 50,
                }),
            });

            const result = await readApiJson<{ files?: DriveFile[]; error?: string }>(response);

            if (!response.ok) {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to load files (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }

            setFiles(result.files || []);
        } catch (error: unknown) {
            console.error("Load files error:", error);
            toast.error("Failed to load files", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) {
            toast.error("Please enter a folder name");
            return;
        }

        if (!user) return;

        setCreatingFolder(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });

            const response = await fetch("/api/drive/create-folder", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    clientName: newFolderName,
                }),
            });

            const result = await readApiJson<{ success?: boolean; error?: string }>(response);

            if (response.ok && result?.success) {
                toast.success("Folder created!", {
                    description: `${newFolderName} with sub-folders`,
                });
                setNewFolderName("");
                setShowCreateFolder(false);
                loadFiles();
            } else {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to create folder (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }
        } catch (error: unknown) {
            console.error("Create folder error:", error);
            toast.error("Failed to create folder", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setCreatingFolder(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        setUploading(true);

        try {
            const headers = await buildAuthHeaders(user, {
                idempotencyKey: crypto.randomUUID(),
            });

            const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64Content = reader.result;
                    if (typeof base64Content !== "string") {
                        reject(new Error("Failed to read file (unexpected result type)"));
                        return;
                    }
                    const parts = base64Content.split(",");
                    if (parts.length < 2) {
                        reject(new Error("Failed to parse file content"));
                        return;
                    }
                    resolve(parts[1]);
                };
                reader.onerror = () => reject(new Error("Failed to read file"));
                reader.readAsDataURL(file);
            });

            const response = await fetch("/api/drive/upload", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    fileName: file.name,
                    mimeType: file.type || "application/octet-stream",
                    fileContent: base64Data,
                }),
            });

            const result = await readApiJson<{ success?: boolean; error?: string }>(response);

            if (!response.ok || !result?.success) {
                const cid = getResponseCorrelationId(response);
                const baseMessage = result?.error || `Failed to upload file (status ${response.status})`;
                throw new Error(`${baseMessage}${cid ? ` cid=${cid}` : ""}`);
            }

            toast.success("File uploaded!", {
                description: file.name,
            });
            loadFiles();
        } catch (error: unknown) {
            console.error("Upload error:", error);
            toast.error("Failed to upload file", {
                description: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    return (
        <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
            <CardHeader className="border-b border-zinc-800">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                        <Folder className="h-5 w-5 text-blue-500" />
                        Google Drive Files
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowCreateFolder(!showCreateFolder)}
                            className="border-zinc-700 text-zinc-400 hover:text-white"
                        >
                            <FolderPlus className="h-4 w-4 mr-2" />
                            New Folder
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById("file-upload")?.click()}
                            disabled={uploading}
                            className="border-zinc-700 text-zinc-400 hover:text-white"
                        >
                            {uploading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4 mr-2" />
                                    Upload
                                </>
                            )}
                        </Button>
                        <input
                            id="file-upload"
                            type="file"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                    </div>
                </div>

                {showCreateFolder && (
                    <div className="mt-4 flex items-center gap-2">
                        <Input
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Client Name (e.g., ABC Healthcare)"
                            className="bg-zinc-900 border-zinc-700 text-white"
                            onKeyPress={(e) => e.key === "Enter" && handleCreateFolder()}
                        />
                        <Button
                            onClick={handleCreateFolder}
                            disabled={creatingFolder}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-500"
                        >
                            {creatingFolder ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Create"
                            )}
                        </Button>
                    </div>
                )}
            </CardHeader>
            <CardContent className="p-0">
                {loading ? (
                    <div className="flex items-center justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center">
                        <Folder className="h-12 w-12 text-zinc-700 mb-4" />
                        <p className="text-sm text-zinc-400">No files found</p>
                        <p className="text-xs text-zinc-600 mt-1">
                            Upload files or create folders to get started
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-800">
                        {files.map((file) => (
                            <div
                                key={file.id}
                                className="flex items-center justify-between p-4 hover:bg-zinc-900/50 transition-colors"
                            >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    {file.mimeType === "application/vnd.google-apps.folder" ? (
                                        <Folder className="h-5 w-5 text-blue-400 shrink-0" />
                                    ) : (
                                        <File className="h-5 w-5 text-zinc-400 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm text-white truncate">{file.name}</p>
                                        <p className="text-xs text-zinc-500 capitalize">
                                            {file.mimeType.split(".").pop()?.replace("application/vnd.google-apps.", "")}
                                        </p>
                                    </div>
                                </div>
                                {file.webViewLink && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => window.open(file.webViewLink, "_blank")}
                                        className="text-zinc-400 hover:text-white shrink-0"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
