import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseJson } from "@/lib/api/validation";
import { getAdminDb } from "@/lib/firebase-admin";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import type { LeadSource, LeadSourceRequest } from "@/lib/leads/types";

type LeadRunTemplate = {
  templateId: string;
  name: string;
  clientName?: string | null;
  params: LeadSourceRequest;
  outreach?: {
    businessKey?: "aicf" | "rng" | "rts" | "rt";
    useSMS?: boolean;
    useAvatar?: boolean;
    useOutboundCall?: boolean;
    draftFirst?: boolean;
  };
};

function optionalTrimmedString(maxLength: number) {
  return z.preprocess((value) => {
    if (value == null) return undefined;
    const normalized = String(value).trim();
    if (!normalized) return undefined;
    return normalized.slice(0, maxLength);
  }, z.string().min(1).max(maxLength).optional());
}

function optionalBoundedInt(min: number, max: number) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    const rounded = Math.round(parsed);
    return Math.min(max, Math.max(min, rounded));
  }, z.number().int().min(min).max(max).optional());
}

function optionalBooleanLike() {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    }
    return undefined;
  }, z.boolean().optional());
}

const sourcesSchema = z
  .preprocess((value) => {
    if (!Array.isArray(value)) return undefined;
    return value
      .map((source) => (typeof source === "string" ? source.trim() : ""))
      .filter(
        (source): source is LeadSource =>
          source === "googlePlaces" || source === "firestore" || source === "apifyMaps"
      );
  }, z.array(z.enum(["googlePlaces", "firestore", "apifyMaps"] satisfies LeadSource[])).optional())
  .transform((sources) => (sources && sources.length > 0 ? sources : undefined));

const templateNameSchema = z.preprocess(
  (value) => String(value ?? "").trim().slice(0, 120),
  z.string().min(1).max(120)
);

const paramsSchema = z.object({
  // Allow longer natural-language descriptions; downstream providers may further truncate.
  query: optionalTrimmedString(500),
  industry: optionalTrimmedString(80),
  location: optionalTrimmedString(120),
  // Be tolerant to number-like strings coming from clients.
  limit: optionalBoundedInt(1, 100),
  minScore: optionalBoundedInt(0, 100),
  sources: sourcesSchema.optional(),
  includeEnrichment: optionalBooleanLike(),
  budget: z
    .object({
      maxCostUsd: z.preprocess((value) => {
        if (value == null || value === "") return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.min(100, Math.max(0.05, parsed));
      }, z.number().positive().max(100).optional()),
      maxPages: optionalBoundedInt(1, 20),
      maxRuntimeSec: optionalBoundedInt(5, 180),
    })
    .optional(),
});

const outreachSchema = z
  .object({
    businessKey: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : undefined),
        z.enum(["aicf", "rng", "rts", "rt"]).optional()
      )
      .optional(),
    useSMS: optionalBooleanLike(),
    useAvatar: optionalBooleanLike(),
    useOutboundCall: optionalBooleanLike(),
    draftFirst: optionalBooleanLike(),
  })
  .optional();

const bodySchema = z.object({
  templateId: optionalTrimmedString(120),
  // Allow slightly longer names since users often paste their ICP / query as the template label.
  name: templateNameSchema,
  clientName: optionalTrimmedString(120),
  params: paramsSchema,
  outreach: outreachSchema,
});

function templatesRef(uid: string) {
  return getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("lead_run_templates");
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);

    const snap = await templatesRef(user.uid)
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();

    const templates: LeadRunTemplate[] = snap.docs.map((doc) => {
      const data = doc.data() as Partial<LeadRunTemplate> & {
        params?: LeadSourceRequest;
        outreach?: LeadRunTemplate["outreach"];
      };
      return {
        templateId: doc.id,
        name: String(data.name || "Untitled"),
        clientName: data.clientName ?? null,
        params: data.params || {},
        outreach: data.outreach || {},
      };
    });

    return NextResponse.json({ templates });
  },
  { route: "leads.templates.list" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);

    const id = body.templateId || crypto.randomUUID();
    const docRef = templatesRef(user.uid).doc(id);

    await getAdminDb().runTransaction(async (tx) => {
      const existing = await tx.get(docRef);
      const now = FieldValue.serverTimestamp();

      const next = stripUndefined({
        name: body.name,
        clientName: body.clientName || null,
        params: body.params,
        outreach: body.outreach || {},
        updatedAt: now,
        createdAt: existing.exists ? undefined : now,
      }) as Record<string, unknown>;

      tx.set(docRef, next, { merge: true });
    });

    const response: LeadRunTemplate = {
      templateId: id,
      name: body.name,
      clientName: body.clientName || null,
      params: body.params,
      outreach: body.outreach || {},
    };

    return NextResponse.json({ template: response });
  },
  { route: "leads.templates.upsert" }
);
