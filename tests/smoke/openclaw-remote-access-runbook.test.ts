import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

function readText(pathParts: string[]) {
  return readFileSync(join(process.cwd(), ...pathParts), "utf8");
}

describe("openclaw remote access runbook smoke", () => {
  it("documents serve-first access, verification, and rollback", () => {
    const runbook = readText(["please-review", "docs", "runbook_remote_access.md"]);
    const fromRootRunbook = readText(["please-review", "from-root", "docs", "runbook_remote_access.md"]);

    expect(fromRootRunbook).toBe(runbook);
    expect(runbook).toContain("curl -I http://127.0.0.1:18789");
    expect(runbook).toContain("sudo tailscale serve --bg --https 8443 http://127.0.0.1:18789");
    expect(runbook).toContain("tailscale serve status");
    expect(runbook).toContain("sudo tailscale serve reset");
    expect(runbook).toContain("sudo tailscale funnel --bg --set-path /googlechat http://127.0.0.1:18789/googlechat");
    expect(runbook).toContain("sudo tailscale funnel reset");
    expect(runbook).toContain("bash scripts/tailscale_admin_setup.sh");
    expect(runbook).toContain("ssh marcu@<node-name>.<tailnet>.ts.net");
    expect(runbook).toContain("openclaw-healthcheck.timer");
    expect(runbook).toContain("openclaw-weekly-update.timer");
  });
});
