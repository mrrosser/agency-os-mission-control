import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_DEFAULT_MODEL_ID || "eleven_turbo_v2_5";
const CALL_AUDIO_TTL_HOURS = Number.parseInt(process.env.CALL_AUDIO_TTL_HOURS || "24", 10);
const MAX_CALL_SCRIPT_CHARS = Number.parseInt(process.env.ELEVENLABS_CALL_MAX_CHARS || "450", 10);
const MAX_EMBEDDED_AUDIO_BYTES = Number.parseInt(process.env.ELEVENLABS_CALL_MAX_AUDIO_BYTES || "700000", 10);

const BUSINESS_VOICE_ENV: Record<string, string> = {
  aicf: "ELEVENLABS_VOICE_ID_AICF",
  rng: "ELEVENLABS_VOICE_ID_RNG",
  rts: "ELEVENLABS_VOICE_ID_RTS",
  rt: "ELEVENLABS_VOICE_ID_RTS",
};

export interface VoiceProfile {
  businessKey?: string;
  voiceId: string;
  modelId: string;
}

export interface HostedCallAudioResult {
  clipId: string;
  audioUrl: string;
  voiceId: string;
  modelId: string;
  bytes: number;
}

interface CreateHostedCallAudioInput {
  uid: string;
  elevenLabsKey: string;
  origin: string;
  text: string;
  businessKey?: string;
  voiceId?: string;
  modelId?: string;
  runId?: string;
  leadDocId?: string;
  correlationId?: string;
}

function normalizeBusinessKey(value?: string): string | undefined {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || undefined;
}

function clipScript(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, Math.max(1, MAX_CALL_SCRIPT_CHARS));
}

function clipExpiryDate(): Date {
  const hours = Number.isFinite(CALL_AUDIO_TTL_HOURS) && CALL_AUDIO_TTL_HOURS > 0 ? CALL_AUDIO_TTL_HOURS : 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function envVoiceForBusiness(businessKey?: string): string | undefined {
  const normalized = normalizeBusinessKey(businessKey);
  if (!normalized) return undefined;
  const envKey = BUSINESS_VOICE_ENV[normalized];
  if (!envKey) return undefined;
  return process.env[envKey] || undefined;
}

export function resolveVoiceProfile(input: {
  businessKey?: string;
  voiceId?: string;
  modelId?: string;
}): VoiceProfile {
  const businessKey = normalizeBusinessKey(input.businessKey);
  const configuredVoice = envVoiceForBusiness(businessKey);
  return {
    businessKey,
    voiceId: (input.voiceId || configuredVoice || DEFAULT_VOICE_ID).trim(),
    modelId: (input.modelId || DEFAULT_MODEL_ID).trim(),
  };
}

export async function synthesizeCallAudio(input: {
  elevenLabsKey: string;
  text: string;
  voiceId: string;
  modelId: string;
  log?: Logger;
}): Promise<Buffer> {
  const script = clipScript(input.text);
  if (!script) {
    throw new ApiError(400, "Call script is empty");
  }

  input.log?.info("voice.call.synthesize.start", {
    voiceId: input.voiceId,
    modelId: input.modelId,
    chars: script.length,
  });

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}`, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": input.elevenLabsKey,
    },
    body: JSON.stringify({
      text: script,
      model_id: input.modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.78,
        style: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new ApiError(502, `ElevenLabs API error: ${errorText || response.statusText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length > MAX_EMBEDDED_AUDIO_BYTES) {
    throw new ApiError(
      413,
      `Generated audio too large (${audioBuffer.length} bytes). Reduce script length for call playback.`
    );
  }

  input.log?.info("voice.call.synthesize.done", {
    voiceId: input.voiceId,
    bytes: audioBuffer.length,
  });

  return audioBuffer;
}

export async function createHostedCallAudio(
  input: CreateHostedCallAudioInput,
  log?: Logger
): Promise<HostedCallAudioResult> {
  const profile = resolveVoiceProfile({
    businessKey: input.businessKey,
    voiceId: input.voiceId,
    modelId: input.modelId,
  });

  const audioBuffer = await synthesizeCallAudio({
    elevenLabsKey: input.elevenLabsKey,
    text: input.text,
    voiceId: profile.voiceId,
    modelId: profile.modelId,
    log,
  });

  const clipRef = getAdminDb().collection("call_audio_clips").doc();
  const expiresAt = clipExpiryDate();
  const clipId = clipRef.id;
  const audioBase64 = audioBuffer.toString("base64");

  await clipRef.set({
    uid: input.uid,
    runId: input.runId || null,
    leadDocId: input.leadDocId || null,
    businessKey: profile.businessKey || null,
    voiceId: profile.voiceId,
    modelId: profile.modelId,
    mimeType: "audio/mpeg",
    bytes: audioBuffer.length,
    audioBase64,
    correlationId: input.correlationId || null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
    servedCount: 0,
  });

  const normalizedOrigin = input.origin.replace(/\/+$/, "");
  const audioUrl = `${normalizedOrigin}/api/public/call-audio/${encodeURIComponent(clipId)}`;

  log?.info("voice.call.hosted.created", {
    clipId,
    businessKey: profile.businessKey || null,
    bytes: audioBuffer.length,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    clipId,
    audioUrl,
    voiceId: profile.voiceId,
    modelId: profile.modelId,
    bytes: audioBuffer.length,
  };
}
