import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import {
  SOCIAL_ONBOARDING_STEP_IDS,
  getSocialOnboardingStatus,
  setSocialOnboardingStepCompletion,
} from "@/lib/social/onboarding";

const bodySchema = z.object({
  stepId: z.enum(SOCIAL_ONBOARDING_STEP_IDS),
  completed: z.boolean().default(true),
});

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const status = await getSocialOnboardingStatus(user.uid);
    return NextResponse.json({
      ok: true,
      ...status,
      correlationId,
    });
  },
  { route: "social.onboarding.status.get" }
);

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    const completedStepIds = await setSocialOnboardingStepCompletion({
      uid: user.uid,
      stepId: body.stepId,
      completed: body.completed,
    });
    return NextResponse.json({
      ok: true,
      stepId: body.stepId,
      completed: body.completed,
      completedStepIds,
      correlationId,
    });
  },
  { route: "social.onboarding.status.post" }
);
