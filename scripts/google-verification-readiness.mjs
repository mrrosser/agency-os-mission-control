function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(url) {
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function main() {
  const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || "https://leadflow-review.web.app").replace(
    /\/+$/,
    ""
  );
  const host = new URL(baseUrl).hostname;

  const [login, privacy, terms] = await Promise.all([
    fetchText(`${baseUrl}/login`),
    fetchText(`${baseUrl}/privacy`),
    fetchText(`${baseUrl}/terms`),
  ]);

  const checks = [
    {
      id: "privacy-page",
      pass: privacy.ok,
      detail: privacy.ok ? "Privacy page reachable." : `Privacy page failed: ${privacy.status}`,
    },
    {
      id: "terms-page",
      pass: terms.ok,
      detail: terms.ok ? "Terms page reachable." : `Terms page failed: ${terms.status}`,
    },
    {
      id: "login-links",
      pass: login.ok && login.text.includes('href="/privacy"') && login.text.includes('href="/terms"'),
      detail: "Login contains /privacy and /terms links.",
    },
    {
      id: "app-name",
      pass: login.ok && login.text.toLowerCase().includes("mission control"),
      detail: "Login contains app name text.",
    },
    {
      id: "custom-domain",
      pass: !host.endsWith(".web.app"),
      detail: host.endsWith(".web.app")
        ? "Custom domain not configured (warning for verification)."
        : `Custom domain detected: ${host}`,
      warning: true,
    },
  ];

  const hardFailures = checks.filter((check) => !check.pass && !check.warning);
  const warnings = checks.filter((check) => !check.pass && check.warning);

  console.log(JSON.stringify({ baseUrl, checks, warnings: warnings.length, failures: hardFailures.length }, null, 2));

  assert(hardFailures.length === 0, `Verification readiness failed with ${hardFailures.length} blocking issue(s).`);
}

main().catch((error) => {
  console.error("[verification-readiness] failed", error);
  process.exit(1);
});

