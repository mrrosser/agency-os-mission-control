import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflows = [
  ".github/workflows/firebase-hosting-merge.yml",
  ".github/workflows/firebase-hosting-pull-request.yml",
];

describe("Firebase deployment environment propagation", () => {
  it.each(workflows)("revokes the Agent Nexus allowlist when the secret is empty in %s", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");

    expect(source).toContain(
      'ENV_UPDATES="$ENV_UPDATES##AGENT_ACTION_ALLOWED_UIDS=$AGENT_ACTION_ALLOWED_UIDS"'
    );
    expect(source).not.toContain(
      'append_env_update "AGENT_ACTION_ALLOWED_UIDS" "$AGENT_ACTION_ALLOWED_UIDS"'
    );
    expect(source).toContain("group: firebase-shared-ssr-leadflow-review");
    expect(source).toContain("queue: max");
    expect(source).toContain("cancel-in-progress: false");
  });
});
