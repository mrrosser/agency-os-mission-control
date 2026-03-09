export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export const FIREBASE_CLIENT_CONFIG_KEYS: Array<keyof FirebaseClientConfig> = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

type PartialFirebaseClientConfig = Partial<Record<keyof FirebaseClientConfig, string>>;

function normalizeValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function buildFirebaseClientConfigFromEnv(
  env: Record<string, string | undefined>
): PartialFirebaseClientConfig {
  return {
    apiKey: normalizeValue(env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: normalizeValue(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: normalizeValue(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: normalizeValue(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalizeValue(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: normalizeValue(env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };
}

export function buildFirebaseClientConfigFromDefaults(
  defaultsJson: string | undefined
): PartialFirebaseClientConfig {
  if (!defaultsJson) return {};

  try {
    const parsed = JSON.parse(defaultsJson) as { config?: PartialFirebaseClientConfig };
    return {
      apiKey: normalizeValue(parsed.config?.apiKey),
      authDomain: normalizeValue(parsed.config?.authDomain),
      projectId: normalizeValue(parsed.config?.projectId),
      storageBucket: normalizeValue(parsed.config?.storageBucket),
      messagingSenderId: normalizeValue(parsed.config?.messagingSenderId),
      appId: normalizeValue(parsed.config?.appId),
    };
  } catch {
    return {};
  }
}

export function resolveFirebaseClientConfig(options: {
  env?: Record<string, string | undefined>;
  defaultsJson?: string | undefined;
  injected?: PartialFirebaseClientConfig | undefined;
}): PartialFirebaseClientConfig {
  return {
    ...buildFirebaseClientConfigFromDefaults(options.defaultsJson),
    ...buildFirebaseClientConfigFromEnv(options.env ?? {}),
    ...options.injected,
  };
}

export function findMissingFirebaseClientConfig(
  config: PartialFirebaseClientConfig
): Array<keyof FirebaseClientConfig> {
  return FIREBASE_CLIENT_CONFIG_KEYS.filter((key) => !normalizeValue(config[key]));
}

export function buildFirebaseClientConfigScript(options: {
  env?: Record<string, string | undefined>;
  defaultsJson?: string | undefined;
  injected?: PartialFirebaseClientConfig | undefined;
}): string {
  const config = resolveFirebaseClientConfig(options);
  const serializedConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.__LEADFLOW_FIREBASE_CONFIG__=${serializedConfig};`;
}
