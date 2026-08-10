import "server-only";

import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";

const APPLICATION_DESK_ORIGIN =
  "https://ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app";
const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const FIXED_UPSTREAM_PATHS = new Set([
  "/api/workspaces",
  "/api/artist-manager/application-reviews",
  "/api/artist-manager/application-reviews/import-prepared",
]);
const DECISION_UPSTREAM_PATH_PATTERN =
  /^\/api\/artist-manager\/application-reviews\/application_review_[a-f0-9]{24}\/decision$/;

interface ForwardOptions {
  request: Request;
  path: string;
  method: "GET" | "POST";
  correlationId: string;
  log: Logger;
  maxRequestBytes?: number;
  requireWorkspace?: boolean;
}

function requireBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 20_000) {
    throw new ApiError(401, "Missing or invalid Authorization header.");
  }
  return authorization;
}

function readWorkspaceId(request: Request, required: boolean): string | null {
  const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
  if (!workspaceId) {
    if (required) throw new ApiError(400, "X-Workspace-Id is required.");
    return null;
  }
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new ApiError(400, "X-Workspace-Id is invalid.");
  }
  return workspaceId;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  overflowStatus: 413 | 502,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("application desk proxy body limit exceeded");
        throw new ApiError(overflowStatus, "Application Desk response exceeded its safety limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readRequestBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new ApiError(413, "Request body is too large.");
    }
  }
  return readBoundedBody(request.body, maxBytes, 413);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

export async function forwardApplicationDeskRequest({
  request,
  path,
  method,
  correlationId,
  log,
  maxRequestBytes = 0,
  requireWorkspace = false,
}: ForwardOptions): Promise<NextResponse> {
  if (!FIXED_UPSTREAM_PATHS.has(path) && !DECISION_UPSTREAM_PATH_PATTERN.test(path)) {
    throw new ApiError(500, "Application Desk proxy route is invalid.");
  }

  const authorization = requireBearerToken(request);
  const workspaceId = readWorkspaceId(request, requireWorkspace);
  const body = method === "POST" ? await readRequestBody(request, maxRequestBytes) : undefined;
  const headers = new Headers({
    authorization,
    accept: "application/json",
    "x-correlation-id": correlationId,
  });
  if (workspaceId) headers.set("x-workspace-id", workspaceId);
  if (method === "POST") headers.set("content-type", "application/json");

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || "";
  if (idempotencyKey) {
    if (idempotencyKey.length > 160 || /[^A-Za-z0-9_.:-]/.test(idempotencyKey)) {
      throw new ApiError(400, "X-Idempotency-Key is invalid.");
    }
    headers.set("x-idempotency-key", idempotencyKey);
  }

  log.info("application_desk.proxy_started", {
    method,
    upstreamPath: path,
    workspaceId,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${APPLICATION_DESK_ORIGIN}${path}`, {
      method,
      headers,
      body: body && body.byteLength > 0 ? toArrayBuffer(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    log.warn("application_desk.proxy_unavailable", {
      method,
      upstreamPath: path,
      workspaceId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw new ApiError(502, "Application Desk service is temporarily unavailable.");
  }

  const declaredLength = Number(upstream.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    await upstream.body?.cancel("application desk upstream response too large");
    throw new ApiError(502, "Application Desk response exceeded its safety limit.");
  }

  const responseBody = await readBoundedBody(
    upstream.body,
    MAX_UPSTREAM_RESPONSE_BYTES,
    502,
  );
  const contentType = upstream.headers.get("content-type")?.toLowerCase() || "";
  if (responseBody.byteLength > 0 && !contentType.includes("application/json")) {
    throw new ApiError(502, "Application Desk returned an invalid response type.");
  }

  log.info("application_desk.proxy_completed", {
    method,
    upstreamPath: path,
    workspaceId,
    upstreamStatus: upstream.status,
  });

  return new NextResponse(responseBody.byteLength > 0 ? toArrayBuffer(responseBody) : null, {
    status: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-type": contentType || "application/json; charset=utf-8",
    },
  });
}
