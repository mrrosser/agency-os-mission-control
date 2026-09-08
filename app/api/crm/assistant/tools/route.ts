import { createAssistantRoute } from "@/lib/crm/assistant/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const POST = createAssistantRoute("tools");
