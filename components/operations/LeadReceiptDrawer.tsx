"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { ExternalLink } from "lucide-react";

export type ReceiptActionStatus = "complete" | "error" | "skipped" | "simulated";

export interface LeadReceiptActionView {
  actionId?: string;
  status?: ReceiptActionStatus;
  dryRun?: boolean;
  replayed?: boolean;
  correlationId?: string;
  createdAt?: string;
  updatedAt?: string;
  data?: Record<string, unknown>;
}

export interface LeadReceiptLeadView {
  leadDocId: string;
  id?: string;
  companyName?: string;
  founderName?: string;
  email?: string;
  phone?: string;
  phones?: string[];
  website?: string;
  googleMapsUrl?: string;
  placePhotos?: Array<{
    ref: string;
    width: number;
    height: number;
    htmlAttributions?: string[];
  }>;
  websiteDomain?: string;
  socialLinks?: Partial<{
    linkedin: string;
    facebook: string;
    instagram: string;
    x: string;
    youtube: string;
    tiktok: string;
  }>;
  location?: string;
  industry?: string;
  rating?: number;
  reviewCount?: number;
  businessStatus?: string;
  openNow?: boolean;
  openingHours?: string[];
  priceLevel?: number;
  lat?: number;
  lng?: number;
  source?: string;
  enriched?: boolean;
  score?: number;
  actions?: LeadReceiptActionView[];
}

const STATUS_BADGE: Record<ReceiptActionStatus, string> = {
  complete: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-200",
  simulated: "bg-cyan-500/15 border border-cyan-500/30 text-cyan-200",
  skipped: "bg-zinc-700/40 border border-zinc-600 text-zinc-200",
  error: "bg-red-500/15 border border-red-500/30 text-red-200",
};

function parseDate(value?: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function latencyText(createdAt?: string, updatedAt?: string): string | null {
  const start = parseDate(createdAt);
  const end = parseDate(updatedAt);
  if (!start || !end || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function externalLinks(data?: Record<string, unknown>): Array<{ label: string; href: string }> {
  if (!data) return [];
  const links: Array<{ label: string; href: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    if (!/^https?:\/\//i.test(value)) continue;
    links.push({
      label: key,
      href: value,
    });
  }
  return links;
}

function normalizeHttpUrl(value?: string): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function stripAttributionHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function LeadReceiptDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadReceiptLeadView | null;
}) {
  const { user } = useAuth();
  const actions = (props.lead?.actions || []).slice().sort((a, b) => {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  const websiteHref = normalizeHttpUrl(props.lead?.website);
  const socials = props.lead?.socialLinks || {};
  const placePhotos = useMemo(() => props.lead?.placePhotos ?? [], [props.lead?.placePhotos]);

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const createdUrls: string[] = [];

    async function load() {
      setPhotoError(null);
      setPhotoUrls({});

      if (!props.open) return;
      if (!user) return;
      if (!placePhotos.length) return;

      const token = await user.getIdToken();
      const next: Record<string, string> = {};

      // Load a small gallery. Keep it simple: sequential fetch to avoid hammering the backend.
      for (const photo of placePhotos.slice(0, 3)) {
        if (cancelled) break;
        const maxWidth = Math.max(240, Math.min(720, photo.width || 512));
        const res = await fetch(
          `/api/google/places/photo?ref=${encodeURIComponent(photo.ref)}&maxWidth=${encodeURIComponent(String(maxWidth))}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Correlation-Id": crypto.randomUUID(),
            },
            signal: controller.signal,
          }
        );
        if (!res.ok) continue;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        next[photo.ref] = url;
      }

      if (!cancelled) setPhotoUrls(next);
    }

    void load().catch((error: unknown) => {
      if (cancelled) return;
      setPhotoError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
      controller.abort();
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [user, props.open, props.lead?.leadDocId, placePhotos]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-white">{props.lead?.companyName || "Receipt Details"}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {props.lead?.founderName || "Lead"} {props.lead?.score ? `• ICP ${props.lead.score}` : ""}
          </DialogDescription>
        </DialogHeader>

        {props.lead ? (
          <div className="space-y-3">
            {placePhotos.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-200">Photos</p>
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                    Google Places
                  </Badge>
                </div>
                {photoError && (
                  <div className="mt-2 text-xs text-red-300">Photo load failed: {photoError}</div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {placePhotos.slice(0, 3).map((photo) => {
                    const url = photoUrls[photo.ref];
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- blob URL is generated at runtime (Next/Image can't optimize it).
                      <img
                        key={photo.ref}
                        src={url}
                        alt={`${props.lead?.companyName || "Lead"} photo`}
                        className="aspect-[4/3] w-full rounded-md border border-zinc-800 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        key={photo.ref}
                        className="aspect-[4/3] w-full animate-pulse rounded-md border border-zinc-800 bg-zinc-900/40"
                      />
                    );
                  })}
                </div>
                {(() => {
                  const attributions = placePhotos
                    .flatMap((p) => (Array.isArray(p.htmlAttributions) ? p.htmlAttributions : []))
                    .map(stripAttributionHtml)
                    .filter(Boolean);
                  if (attributions.length === 0) return null;
                  const unique = Array.from(new Set(attributions)).slice(0, 3);
                  return <div className="mt-2 text-[11px] text-zinc-500">Attribution: {unique.join(" • ")}</div>;
                })()}
              </div>
            )}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="flex flex-wrap gap-2">
                {websiteHref && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                  >
                    <a href={websiteHref} target="_blank" rel="noreferrer">
                      Website
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                {props.lead.googleMapsUrl && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                  >
                    <a href={props.lead.googleMapsUrl} target="_blank" rel="noreferrer">
                      Maps
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                {props.lead.email && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                  >
                    <a href={`mailto:${props.lead.email}`}>
                      Email
                    </a>
                  </Button>
                )}
                {props.lead.phone && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                  >
                    <a href={`tel:${props.lead.phone}`}>
                      Call
                    </a>
                  </Button>
                )}
                {socials.linkedin && (
                  <Button asChild size="sm" variant="outline" className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white">
                    <a href={socials.linkedin} target="_blank" rel="noreferrer">
                      LinkedIn
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                {socials.instagram && (
                  <Button asChild size="sm" variant="outline" className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white">
                    <a href={socials.instagram} target="_blank" rel="noreferrer">
                      Instagram
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                {socials.facebook && (
                  <Button asChild size="sm" variant="outline" className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white">
                    <a href={socials.facebook} target="_blank" rel="noreferrer">
                      Facebook
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                {[props.lead.websiteDomain, props.lead.location, props.lead.industry].filter(Boolean).join(" • ")}
              </div>
              {(props.lead.businessStatus || typeof props.lead.openNow === "boolean") && (
                <div className="mt-1 text-xs text-zinc-500">
                  {props.lead.businessStatus ? `Status ${props.lead.businessStatus}` : "Status n/a"}
                  {typeof props.lead.openNow === "boolean" ? ` • ${props.lead.openNow ? "Open now" : "Closed now"}` : ""}
                </div>
              )}
              {(typeof props.lead.rating === "number" || typeof props.lead.reviewCount === "number") && (
                <div className="mt-1 text-xs text-zinc-500">
                  {typeof props.lead.rating === "number" ? `Rating ${props.lead.rating.toFixed(1)}` : "Rating n/a"}
                  {typeof props.lead.reviewCount === "number" ? ` • ${props.lead.reviewCount} reviews` : ""}
                </div>
              )}
              {Array.isArray(props.lead.openingHours) && props.lead.openingHours.length > 0 && (
                <div className="mt-2 text-xs text-zinc-500">
                  <div className="font-medium text-zinc-400">Hours</div>
                  <div className="mt-1 whitespace-pre-line">{props.lead.openingHours.join("\n")}</div>
                </div>
              )}
            </div>

            {actions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
                No action receipts were recorded for this lead.
              </div>
            ) : (
              actions.map((action) => {
                const status = (action.status || "skipped") as ReceiptActionStatus;
                const links = externalLinks(action.data);
                const latency = latencyText(action.createdAt, action.updatedAt);
                return (
                  <div key={`${action.actionId || "action"}-${action.updatedAt || "0"}`} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-zinc-200">{action.actionId || "action"}</p>
                      <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                      {action.replayed && <Badge className="bg-zinc-800 text-zinc-300">idempotent replay</Badge>}
                      {action.dryRun && <Badge className="bg-yellow-500/20 text-yellow-200">dry run</Badge>}
                      {latency && <Badge className="bg-blue-500/20 text-blue-200">latency {latency}</Badge>}
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      {action.updatedAt ? `updated ${new Date(action.updatedAt).toLocaleString()}` : "no timestamp"}
                    </div>
                    {links.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {links.map((link) => (
                          <Button
                            key={`${action.actionId || "action"}-${link.label}`}
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-8 border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white"
                          >
                            <a href={link.href} target="_blank" rel="noreferrer">
                              {link.label}
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </a>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
            Pick a lead to inspect receipts.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
