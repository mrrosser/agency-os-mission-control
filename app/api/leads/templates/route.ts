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

const sourcesSchema = z.array(z.enum(["googlePlaces", "firestore"] satisfies LeadSource[]));

const paramsSchema = z.object({
  query: z.string().min(1).max(120).optional(),
  industry: z.string().min(1).max(80).optional(),
  location: z.string().min(1).max(120).optional(),
  // Be tolerant to number-like strings coming from clients.
  limit: z.coerce.number().int().min(1).max(25).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  sources: sourcesSchema.optional(),
  includeEnrichment: z.boolean().optional(),
});

const outreachSchema = z
  .object({
    businessKey: z.enum(["aicf", "rng", "rts", "rt"]).optional(),
    useSMS: z.boolean().optional(),
    useAvatar: z.boolean().optional(),
    useOutboundCall: z.boolean().optional(),
    draftFirst: z.boolean().optional(),
  })
  .optional();

const bodySchema = z.object({
  templateId: z.string().min(1).max(120).optional(),
  // Allow slightly longer names since users often paste their ICP / query as the template label.
  name: z.string().trim().min(1).max(120),
  clientName: z.string().trim().min(1).max(120).optional(),
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
