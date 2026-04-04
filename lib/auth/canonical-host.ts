const DEFAULT_CANONICAL_LOGIN_URL = "https://leadflow-review.web.app/login";

export type LoginHostPolicy = {
  action: "allow" | "redirect" | "warn";
  canonicalLoginUrl: string;
  hostWarning: boolean;
};

export function getCanonicalLoginUrl(): string {
  return process.env.NEXT_PUBLIC_CANONICAL_LOGIN_URL?.trim() || DEFAULT_CANONICAL_LOGIN_URL;
}

export function buildLoginHostPolicy(currentHost: string): LoginHostPolicy {
  const canonicalLoginUrl = getCanonicalLoginUrl();
  const canonicalUrl = new URL(canonicalLoginUrl);
  const normalizedHost = currentHost.trim().toLowerCase();
  const isLocalHost = normalizedHost === "localhost" || normalizedHost === "127.0.0.1";

  if (isLocalHost) {
    return { action: "allow", canonicalLoginUrl, hostWarning: false };
  }

  const isCanonicalHost = normalizedHost === canonicalUrl.hostname.toLowerCase();
  if (!isCanonicalHost && process.env.NEXT_PUBLIC_AUTO_REDIRECT_NON_CANONICAL_LOGIN !== "false") {
    return { action: "redirect", canonicalLoginUrl, hostWarning: true };
  }

  return { action: "warn", canonicalLoginUrl, hostWarning: !isCanonicalHost };
}
