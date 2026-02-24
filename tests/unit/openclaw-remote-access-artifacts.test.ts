import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

function readText(pathParts: string[]) {
  return readFileSync(join(process.cwd(), ...pathParts), "utf8");
}

function expectMirrored(pathParts: string[]) {
  const primary = readText(["please-review", ...pathParts]);
  const fromRoot = readText(["please-review", "from-root", ...pathParts]);
  expect(fromRoot).toBe(primary);
  return primary;
}

describe("openclaw remote access artifacts", () => {
  it("keeps gateway compose ports loopback-only", () => {
    const compose = readText(["please-review", "docker", "docker-compose.yml"]);
    const fromRootCompose = readText(["please-review", "from-root", "docker", "docker-compose.yml"]);

    expect(compose).toContain("\"127.0.0.1:${OPENCLAW_PORT}:18789\"");
    expect(compose).not.toContain("\"0.0.0.0:${OPENCLAW_PORT}:18789\"");

    expect(fromRootCompose).toContain("\"127.0.0.1:${OPENCLAW_PORT}:18789\"");
    expect(fromRootCompose).not.toContain("\"0.0.0.0:${OPENCLAW_PORT}:18789\"");
  });

  it("ships an idempotent Tailscale Serve setup script in both deployment trees", () => {
    const script = expectMirrored(["scripts", "tailscale_serve_setup.sh"]);

    expect(script).toContain("tailscale serve --bg --https");
    expect(script).toContain("http://${OPENCLAW_HOST}:${OPENCLAW_PORT}");
    expect(script).toContain("tailscale status --json");
    expect(script).toContain("tailscale serve status");
    expect(script).toContain("Rollback: sudo tailscale serve reset");
  });

  it("ships a guarded Google Chat Funnel script in both deployment trees", () => {
    const script = expectMirrored(["scripts", "tailscale_funnel_googlechat.sh"]);

    expect(script).toContain("GOOGLECHAT_PATH");
    expect(script).toContain("GOOGLECHAT_PATH cannot be /");
    expect(script).toContain("tailscale funnel --bg --set-path");
    expect(script).toContain("http://${OPENCLAW_HOST}:${OPENCLAW_PORT}${GOOGLECHAT_PATH}");
    expect(script).toContain("Rollback: sudo tailscale funnel reset");
  });

  it("includes a boot-time unit that reapplies Serve config", () => {
    const unit = expectMirrored(["ops", "openclaw-tailscale-serve.service"]);

    expect(unit).toContain("After=network-online.target docker.service");
    expect(unit).toContain("ExecStart=/bin/bash /home/marcu/ai-hell-mary/scripts/tailscale_serve_setup.sh");
    expect(unit).toContain("Type=oneshot");
  });

  it("ships Tailscale SSH admin setup script and service", () => {
    const script = expectMirrored(["scripts", "tailscale_admin_setup.sh"]);
    expect(script).toContain("tailscale set --ssh=true");
    expect(script).toContain("tailscale set --ssh=false");
    expect(script).toContain("Admin shell (tailnet): ssh");
    expect(script).toContain("Rollback: sudo tailscale set --ssh=false");

    const unit = expectMirrored(["ops", "openclaw-tailscale-admin.service"]);
    expect(unit).toContain("ExecStart=/bin/bash /home/marcu/ai-hell-mary/scripts/tailscale_admin_setup.sh");
    expect(unit).toContain("Type=oneshot");
  });

  it("ships scheduled healthcheck and weekly update automation", () => {
    const cycleScript = expectMirrored(["scripts", "openclaw_ops_cycle.sh"]);
    expect(cycleScript).toContain("DO_UPDATE");
    expect(cycleScript).toContain("docker compose -f");
    expect(cycleScript).toContain("openclaw health");
    expect(cycleScript).toContain("tailscale serve status");

    const healthService = expectMirrored(["ops", "openclaw-healthcheck.service"]);
    expect(healthService).toContain("Environment=DO_UPDATE=false");
    expect(healthService).toContain("ExecStart=/bin/bash /home/marcu/ai-hell-mary/scripts/openclaw_ops_cycle.sh");

    const healthTimer = expectMirrored(["ops", "openclaw-healthcheck.timer"]);
    expect(healthTimer).toContain("OnUnitActiveSec=15m");
    expect(healthTimer).toContain("Unit=openclaw-healthcheck.service");

    const updateService = expectMirrored(["ops", "openclaw-weekly-update.service"]);
    expect(updateService).toContain("Environment=DO_UPDATE=true");
    expect(updateService).toContain("ExecStart=/bin/bash /home/marcu/ai-hell-mary/scripts/openclaw_ops_cycle.sh");

    const updateTimer = expectMirrored(["ops", "openclaw-weekly-update.timer"]);
    expect(updateTimer).toContain("OnCalendar=Sun *-*-* 04:30:00");
    expect(updateTimer).toContain("Unit=openclaw-weekly-update.service");
  });

  it("keeps legacy tailscale helper scripts on localhost-backed serve/funnel routes", () => {
    const vmRepoint = readText(["please-review", "from-root", "scripts", "vm_tailscale_repoint.sh"]);
    const vmUpdate = readText(["please-review", "from-root", "scripts", "vm_tailscale_update.sh"]);
    const vmStartup = readText(["please-review", "from-root", "scripts", "vm_startup_ensure.sh"]);
    const nativeRepoint = readText(["please-review", "from-root", "scripts", "native_tailscale_repoint.sh"]);

    [vmRepoint, vmUpdate, vmStartup, nativeRepoint].forEach((script) => {
      expect(script).not.toContain("CONTAINER_IP");
      expect(script).toContain("tailscale_serve_setup.sh");
    });

    [vmRepoint, vmUpdate, vmStartup, nativeRepoint].forEach((script) => {
      expect(script).toContain("tailscale_funnel_googlechat.sh");
      expect(script).toContain("ENABLE_GMAIL_PUBSUB_FUNNELS");
      expect(script).toContain("127.0.0.1");
    });
  });
});
