import { describe, expect, it } from "vitest";
import { resolveVoiceProfile } from "@/lib/voice/call-audio";

describe("resolveVoiceProfile", () => {
  it("uses explicit override voice/model values", () => {
    const profile = resolveVoiceProfile({
      businessKey: "rng",
      voiceId: "voice_custom",
      modelId: "model_custom",
    });

    expect(profile.businessKey).toBe("rng");
    expect(profile.voiceId).toBe("voice_custom");
    expect(profile.modelId).toBe("model_custom");
  });
});
