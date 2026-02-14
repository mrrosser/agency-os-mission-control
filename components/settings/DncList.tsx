"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

type DncEntryType = "email" | "phone" | "domain";

type DncEntry = {
  entryId: string;
  type: DncEntryType;
  value: string;
  normalized: string;
  reason?: string | null;
};

function typeLabel(type: DncEntryType): string {
  if (type === "phone") return "Phone";
  if (type === "domain") return "Domain";
  return "Email";
}

export function DncList() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [entries, setEntries] = useState<DncEntry[]>([]);

  const [type, setType] = useState<DncEntryType>("email");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`));
  }, [entries]);

  const loadEntries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const res = await fetch("/api/outreach/dnc", { method: "GET", headers });
      const payload = await readApiJson<{ entries?: DncEntry[]; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to load DNC list${cid ? ` cid=${cid}` : ""}`);
      }
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } catch (e: unknown) {
      toast.error("Failed to load DNC list", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleAdd = async () => {
    if (!user) return;
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error("Enter a value to block");
      return;
    }

    setSaving(true);
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
      const res = await fetch("/api/outreach/dnc", {
        method: "POST",
        headers,
        body: JSON.stringify({ type, value: trimmed, reason: reason.trim() || undefined }),
      });
      const payload = await readApiJson<{ entry?: DncEntry; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to add DNC entry${cid ? ` cid=${cid}` : ""}`);
      }
      const entry = payload.entry;
      if (entry) {
        setEntries((prev) => {
          const next = new Map(prev.map((e) => [e.entryId, e]));
          next.set(entry.entryId, entry);
          return Array.from(next.values());
        });
      }
      setValue("");
      setReason("");
      toast.success("Added to DNC list");
    } catch (e: unknown) {
      toast.error("Failed to add DNC entry", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!user) return;
    setDeleting(entryId);
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
      const res = await fetch("/api/outreach/dnc", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ entryId }),
      });
      const payload = await readApiJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to delete DNC entry${cid ? ` cid=${cid}` : ""}`);
      }
      setEntries((prev) => prev.filter((e) => e.entryId !== entryId));
      toast.success("Removed from DNC list");
    } catch (e: unknown) {
      toast.error("Failed to delete DNC entry", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader>
        <CardTitle>Do Not Contact (DNC)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Entries here are enforced across automated outreach. Use it for unsubscribes, competitors, or anyone you
          should never message.
        </p>

        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-1 space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DncEntryType)}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="domain">Domain</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2 space-y-2">
            <Label>Value</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === "email" ? "lead@example.com" : type === "phone" ? "+15005550006" : "example.com"}
              className="bg-zinc-900 border-zinc-700 text-white"
              disabled={!user}
            />
          </div>

          <div className="md:col-span-2 space-y-2">
            <Label>Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="unsubscribe / competitor / wrong persona"
              className="bg-zinc-900 border-zinc-700 text-white"
              disabled={!user}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!user || saving}
            className="bg-zinc-100 text-black hover:bg-zinc-200"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Add to DNC
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadEntries()}
            disabled={!user || loading}
            className="border-zinc-800 text-zinc-300 hover:text-white"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>

        <div className="space-y-2">
          {sortedEntries.length === 0 ? (
            <p className="text-sm text-zinc-500">No DNC entries yet.</p>
          ) : (
            sortedEntries.map((entry) => (
              <div
                key={entry.entryId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-200">
                    {typeLabel(entry.type)}
                  </Badge>
                  <span className="text-sm text-zinc-200">{entry.value}</span>
                  {entry.reason ? <span className="text-xs text-zinc-500">({entry.reason})</span> : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white"
                  onClick={() => void handleDelete(entry.entryId)}
                  disabled={deleting === entry.entryId}
                  aria-label={`Remove ${entry.value}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleting === entry.entryId ? "Removing..." : "Remove"}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

