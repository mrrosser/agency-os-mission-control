import { z } from "zod";

export const telemetryErrorSchema = z.object({
  eventId: z.string().uuid(),
  kind: z.enum(["client", "react", "server"]),
  message: z.string().min(1).max(4000),
  name: z.string().max(200).optional(),
  stack: z.string().max(20000).optional(),
  url: z.string().max(2000).optional(),
  route: z.string().max(300).optional(),
  userAgent: z.string().max(500).optional(),
  occurredAt: z.string().max(64).optional(), // ISO-ish string; we parse best-effort
  correlationId: z.string().max(200).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type TelemetryErrorInput = z.infer<typeof telemetryErrorSchema>;

