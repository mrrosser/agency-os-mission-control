import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { getAdminAuth } from "@/lib/firebase-admin";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";

export async function requireCalendarOwner(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !authorization.slice(7).trim()) throw new ApiError(401, "Sign in to use Calendar.");
  let user;
  try {
    user = await getAdminAuth().verifyIdToken(authorization.slice(7).trim(), true);
  } catch {
    throw new ApiError(401, "Your sign-in is invalid or revoked. Sign in again.");
  }
  const access = await assertPortfolioRegistryAccess(user.uid);
  if (access.role !== "owner") throw new ApiError(403, "Only the active workspace owner can manage calendar requests.");
  return user;
}

export function assertCalendarApprovalOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const allowed = new Set(["https://leadflow-review.web.app", "https://leadflow-review.firebaseapp.com"]);
  const configured = process.env.MISSION_CONTROL_PUBLIC_ORIGIN?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid");
      allowed.add(parsed.origin);
    } catch {
      throw new ApiError(503, "Calendar approval origin is not configured correctly.");
    }
  }
  if (process.env.NODE_ENV !== "production") {
    const url = new URL(request.url);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) allowed.add(url.origin);
  }
  if (!origin || !allowed.has(origin)) throw new ApiError(403, "Approve this exact event in the signed-in Calendar page.");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") throw new ApiError(403, "Cross-site calendar approval is not allowed.");
}

export async function parseCalendarJson<T>(request: Request, schema: z.ZodSchema<T>, maxBytes = 32 * 1024): Promise<T> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") throw new ApiError(415, "Content-Type must be application/json.");
  const text = await readBoundedRequestBody(request, maxBytes);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError(400, "Invalid JSON body."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "Invalid calendar request.", { issues: parsed.error.issues });
  return parsed.data;
}

export function calendarJson(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
}
