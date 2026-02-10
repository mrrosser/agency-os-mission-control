import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export const DELETE = withApiHandler(
  async ({ request, log, params }) => {
    const user = await requireFirebaseAuth(request, log);
    const templateId = params?.templateId;

    if (!templateId) {
      return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
    }

    await getAdminDb()
      .collection("identities")
      .doc(user.uid)
      .collection("lead_run_templates")
      .doc(templateId)
      .delete();

    return NextResponse.json({ ok: true });
  },
  { route: "leads.templates.delete" }
);

