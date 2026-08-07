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

  it("smokes a pinned runtime revision before routing it and refreshing live Hosting", () => {
    const source = readFileSync(
      join(process.cwd(), ".github/workflows/firebase-hosting-merge.yml"),
      "utf8"
    );

    const candidateTag = source.indexOf(
      '--update-tags="$RELEASE_TAG=$RUNTIME_REVISION"'
    );
    const smoke = source.indexOf("run: npm run test:postdeploy");
    const trafficPromotion = source.indexOf(
      '--to-revisions="$FIREBASE_RUNTIME_REVISION=100"'
    );
    const hostingPromotion = source.indexOf("hosting:clone");

    expect(candidateTag).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(candidateTag);
    expect(trafficPromotion).toBeGreaterThan(smoke);
    expect(hostingPromotion).toBeGreaterThan(trafficPromotion);
    expect(source).toContain('RUNTIME_IMAGE" != "$DEPLOY_IMAGE');
    expect(source).toContain("--no-traffic");
    expect(source).toContain(
      'RUNTIME_SUFFIX="release-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
    );
    expect(source).toContain('--image "$DEPLOY_IMAGE"');
    expect(source).toContain('--revision-suffix "$RUNTIME_SUFFIX"');
    expect(source).toContain(
      'RUNTIME_REVISION="${FIREBASE_SSR_SERVICE}-${RUNTIME_SUFFIX}"'
    );
    expect(source).toContain('CANDIDATE_TRAFFIC" != "0"');
    expect(source).toContain('PREVIOUS_LIVE_TRAFFIC" != "100"');
    expect(source).toContain(
      'TAGGED_CANDIDATE_REVISION" != "$FIREBASE_RUNTIME_REVISION"'
    );
    expect(source).toContain('index("AGENT_ACTION_ALLOWED_UIDS") != null');
    expect(source).toContain(
      '--to-revisions="$PREVIOUS_LIVE_REVISION=100"'
    );
    expect(source).toContain("trap rollback_runtime EXIT");
    expect(source).toContain("TRAFFIC_SWITCHED=0");
    expect(source).toContain('TRAFFIC_SWITCHED" != "1"');
    expect(source).toContain("SMOKE_BASE_URL: ${{ env.SMOKE_BASE_URL }}");
  });

  it("bundles the Agent Nexus knowledge pack into the SSR route", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/agents/control-plane/route.ts"),
      "utf8"
    );

    expect(source).toContain(
      'import knowledgePackV2 from "@/please-review/from-root/config-templates/knowledge-pack.v2.json"'
    );
    expect(source).not.toContain("KNOWLEDGE_PACK_PATH");
    expect(source).not.toContain("fs.readFile(KNOWLEDGE_PACK_PATH");
  });
});
