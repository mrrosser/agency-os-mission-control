import "server-only";
import { resolveFirebaseClientConfig } from "@/lib/firebase-client-config";

/** Read the deployed server environment, not build-time NEXT_PUBLIC substitutions. */
export function getRuntimeFirebaseClientConfig() {
  const runtimeEnv = process.env;
  return resolveFirebaseClientConfig({
    env: runtimeEnv,
    defaultsJson: runtimeEnv.__FIREBASE_DEFAULTS__,
  });
}
