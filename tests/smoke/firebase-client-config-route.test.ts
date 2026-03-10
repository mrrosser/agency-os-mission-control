import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/runtime/firebase-client-config/route";

function createRequest() {
  return new Request("http://localhost/api/runtime/firebase-client-config", { method: "GET" });
}

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("firebase client config route", () => {
  it("returns runtime Firebase config as JavaScript", async () => {
    const originalEnv = {
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };

    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "api-key";
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "leadflow-review.firebaseapp.com";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "leadflow-review";
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "leadflow-review.firebasestorage.app";
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "450880825453";
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:450880825453:web:b715cdd482f122b9667764";

    const response = await GET(
      createRequest() as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(body).toContain("window.__LEADFLOW_FIREBASE_CONFIG__");
    expect(body).toContain("leadflow-review.firebaseapp.com");

    Object.assign(process.env, originalEnv);
  });
});
