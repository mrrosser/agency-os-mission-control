import { describe, expect, it } from "vitest";
import {
  findMissingFirebasePublicEnvKeys,
  parseEnvText,
  REQUIRED_FIREBASE_PUBLIC_ENV_KEYS,
} from "@/scripts/firebase-public-env.mjs";

describe("firebase public env validation", () => {
  it("accepts a complete Firebase public config", () => {
    const env = parseEnvText(`
NEXT_PUBLIC_FIREBASE_API_KEY=abc123
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=leadflow-review.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=leadflow-review
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=leadflow-review.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=450880825453
NEXT_PUBLIC_FIREBASE_APP_ID=1:450880825453:web:b715cdd482f122b9667764
`);

    expect(findMissingFirebasePublicEnvKeys(env)).toEqual([]);
  });

  it("treats blank or commented Firebase public keys as missing", () => {
    const env = parseEnvText(`
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="leadflow-review.firebaseapp.com"
# NEXT_PUBLIC_FIREBASE_PROJECT_ID=leadflow-review
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=leadflow-review.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=1:450880825453:web:b715cdd482f122b9667764
`);

    expect(findMissingFirebasePublicEnvKeys(env)).toEqual([
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    ]);
    expect(REQUIRED_FIREBASE_PUBLIC_ENV_KEYS).toHaveLength(6);
  });
});
