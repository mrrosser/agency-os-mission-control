import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

export async function parseJson<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid request body", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
