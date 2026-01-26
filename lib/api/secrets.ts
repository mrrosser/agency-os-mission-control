import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";

export interface ApiKeys {
    openaiKey?: string;
    twilioSid?: string;
    twilioToken?: string;
    elevenLabsKey?: string;
    heyGenKey?: string;
}

/**
 * Retrieves client-specific API keys from the identities collection.
 */
export async function getUserApiKeys(uid: string): Promise<ApiKeys | null> {
    const doc = await getAdminDb().collection("identities").doc(uid).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return (data?.apiKeys as ApiKeys) || null;
}

/**
 * Helper to resolve a specific key, falling back to environment variables.
 */
export async function resolveSecret(
    uid: string,
    key: keyof ApiKeys,
    envVarName: string
): Promise<string | undefined> {
    const keys = await getUserApiKeys(uid);
    return keys?.[key] || process.env[envVarName];
}
