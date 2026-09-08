import { describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

describe("Firebase Hosting defaults compatibility", () => {
  it("initializes the actual Auth and Firestore SDKs without optional Analytics appId", async () => {
    const app = initializeApp({ apiKey: "test-public-api-key", authDomain: "test.firebaseapp.com", projectId: "test", storageBucket: "test.appspot.com", messagingSenderId: "123" }, "runtime-defaults-unit-test");
    try {
      expect(getAuth(app).currentUser).toBeNull();
      expect(getFirestore(app).app.name).toBe("runtime-defaults-unit-test");
    } finally {
      await deleteApp(app);
    }
  });
});
