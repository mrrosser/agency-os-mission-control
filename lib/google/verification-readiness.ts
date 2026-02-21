import "server-only";

export type VerificationCheckStatus = "pass" | "warn" | "fail";

export interface VerificationCheck {
  id: string;
  label: string;
  status: VerificationCheckStatus;
  detail: string;
}

export interface VerificationReadinessReport {
  status: "ready" | "needs_action";
  generatedAt: string;
  baseUrl: string;
  checks: VerificationCheck[];
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

export async function buildVerificationReadinessReport(baseUrlInput: string): Promise<VerificationReadinessReport> {
  const baseUrl = baseUrlInput.replace(/\/+$/, "");
  const loginUrl = `${baseUrl}/login`;
  const privacyUrl = `${baseUrl}/privacy`;
  const termsUrl = `${baseUrl}/terms`;
  const host = new URL(baseUrl).hostname;

  const [login, privacy, terms] = await Promise.all([
    fetchText(loginUrl),
    fetchText(privacyUrl),
    fetchText(termsUrl),
  ]);

  const checks: VerificationCheck[] = [
    {
      id: "privacy-page",
      label: "Privacy policy page is reachable",
      status: privacy.ok ? "pass" : "fail",
      detail: privacy.ok ? `200 OK at ${privacyUrl}` : `Expected 200, received ${privacy.status}.`,
    },
    {
      id: "terms-page",
      label: "Terms of service page is reachable",
      status: terms.ok ? "pass" : "fail",
      detail: terms.ok ? `200 OK at ${termsUrl}` : `Expected 200, received ${terms.status}.`,
    },
    {
      id: "login-policy-links",
      label: "Login page includes policy links",
      status:
        login.ok && login.text.includes('href="/privacy"') && login.text.includes('href="/terms"')
          ? "pass"
          : "fail",
      detail:
        login.ok && login.text.includes('href="/privacy"') && login.text.includes('href="/terms"')
          ? "Login has /privacy and /terms links."
          : "Login page is missing a visible /privacy or /terms link.",
    },
    {
      id: "login-app-name",
      label: "Login page includes app name",
      status: login.ok && login.text.toLowerCase().includes("mission control") ? "pass" : "warn",
      detail:
        login.ok && login.text.toLowerCase().includes("mission control")
          ? "Found \"Mission Control\" on login page."
          : "Could not find app name text on login page.",
    },
    {
      id: "domain-recommendation",
      label: "Custom production domain configured",
      status: host.endsWith(".web.app") ? "warn" : "pass",
      detail: host.endsWith(".web.app")
        ? "Using default Firebase domain. Google verification is easier with a verified custom domain."
        : `Using custom domain: ${host}`,
    },
  ];

  const hasFailure = checks.some((check) => check.status === "fail");

  return {
    status: hasFailure ? "needs_action" : "ready",
    generatedAt: new Date().toISOString(),
    baseUrl,
    checks,
  };
}
