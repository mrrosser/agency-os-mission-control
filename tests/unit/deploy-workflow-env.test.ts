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

  it("smokes a pinned runtime revision and verifies the rebound Hosting tag before live clone", () => {
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
    const firstChannelDeploy = source.indexOf("hosting:channel:deploy");
    const hostingRebind = source.indexOf(
      "hosting:channel:deploy",
      firstChannelDeploy + 1
    );
    const hostingRebindEnd = source.indexOf("REBIND_COMPLETE=1", hostingRebind);
    const rewriteAssertion = source.indexOf('METADATA_VERIFIED" != "1"');
    const reboundSmoke = source.indexOf(
      'SMOKE_BASE_URL="$FIREBASE_PREVIEW_URL"'
    );
    const hostingPromotion = source.indexOf("hosting:clone");
    const liveVersionAssertion = source.indexOf(
      'LIVE_HOSTING_VERSION" = "$REFRESHED_HOSTING_VERSION"',
      hostingPromotion + 1
    );

    expect(candidateTag).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(candidateTag);
    expect(trafficPromotion).toBeGreaterThan(smoke);
    expect(hostingRebind).toBeGreaterThan(trafficPromotion);
    expect(source.slice(hostingRebind, hostingRebindEnd)).not.toContain(
      '--site "$FIREBASE_HOSTING_SITE"'
    );
    expect(rewriteAssertion).toBeGreaterThan(hostingRebind);
    expect(reboundSmoke).toBeGreaterThan(rewriteAssertion);
    expect(hostingPromotion).toBeGreaterThan(reboundSmoke);
    expect(liveVersionAssertion).toBeGreaterThan(hostingPromotion);
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
    expect(source).toContain(
      'ROLLBACK_TAGS="$PREVIOUS_LIVE_REWRITE_TAG=$PREVIOUS_LIVE_REVISION"'
    );
    expect(source).toContain(
      'ROLLBACK_VERIFIED_TAG_REVISION" != "$PREVIOUS_LIVE_REVISION"'
    );
    expect(source).toContain("trap rollback_runtime EXIT");
    expect(source).toContain("TRAFFIC_SWITCHED=0");
    expect(source).toContain('TRAFFIC_SWITCHED" = "1"');
    expect(source.indexOf('ROLLBACK_TAGS="$PREVIOUS_LIVE_REWRITE_TAG=$PREVIOUS_LIVE_REVISION"')).toBeLessThan(
      source.indexOf('ENCODED_ROLLBACK_VERSION=')
    );
    expect(source).toContain("SMOKE_BASE_URL: ${{ env.SMOKE_BASE_URL }}");
    expect(source).toContain("firebasehosting.googleapis.com/v1beta1/sites/");
    expect(source).toContain('x-goog-user-project: $FIREBASE_PROJECT_ID');
    expect(source).toContain('REBOUND_CANDIDATE_TRAFFIC" != "100"');
    expect(source).toContain(
      'PRE_CLONE_SERVING_REVISION" != "$FIREBASE_RUNTIME_REVISION"'
    );
    expect(source).toContain('REFRESHED_HOSTING_VERSION" != "$PRE_REBIND_HOSTING_VERSION"');
    expect(source).toContain('REFRESHED_HOSTING_STATUS" = "FINALIZED"');
    expect(source).toContain('MATCHING_REWRITE_COUNT" = "1"');
    expect(source).toContain('HOSTING_CLONE_STARTED=1');
    expect(source).toContain('ROLLBACK_LIVE_HOSTING_VERSION" = "$REFRESHED_HOSTING_VERSION"');
    expect(source).toContain('versionName=${ENCODED_ROLLBACK_VERSION}');
    expect(source).toContain('PREVIOUS_LIVE_HOSTING_RELEASE');
    expect(source).toContain('EXPECTED_LIVE_URL="https://${FIREBASE_HOSTING_SITE}.web.app"');
    expect(source).toContain('LIVE_CHANNEL_NAME" = "$EXPECTED_LIVE_CHANNEL"');
  });

  it.each(workflows)(
    "pins and verifies the canonical Mission Control public origin in %s",
    (path) => {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      const canonicalDeclaration = source.indexOf(
        "MISSION_CONTROL_PUBLIC_ORIGIN: https://leadflow-review.web.app"
      );
      const canonicalGuard = source.indexOf(
        '[ "$MISSION_CONTROL_PUBLIC_ORIGIN" != "https://leadflow-review.web.app" ]'
      );
      const runtimeUpdate = source.indexOf(
        'append_env_update "MISSION_CONTROL_PUBLIC_ORIGIN" "$MISSION_CONTROL_PUBLIC_ORIGIN"'
      );
      const revisionUpdate = source.indexOf(
        'gcloud run services update "$FIREBASE_SSR_SERVICE"'
      );
      const revisionVerification = source.indexOf(
        'select(.name == "MISSION_CONTROL_PUBLIC_ORIGIN")'
      );

      expect(canonicalDeclaration).toBeGreaterThan(-1);
      expect(canonicalGuard).toBeGreaterThan(canonicalDeclaration);
      expect(runtimeUpdate).toBeGreaterThan(canonicalGuard);
      expect(revisionUpdate).toBeGreaterThan(runtimeUpdate);
      expect(revisionVerification).toBeGreaterThan(revisionUpdate);
      expect(source).toContain(
        '!= "$MISSION_CONTROL_PUBLIC_ORIGIN" ]; then'
      );
      expect(source).toContain(
        "exact canonical Mission Control public origin."
      );

      if (path.endsWith("firebase-hosting-merge.yml")) {
        const candidateTag = source.indexOf(
          '--update-tags="$RELEASE_TAG=$RUNTIME_REVISION"'
        );
        expect(candidateTag).toBeGreaterThan(revisionVerification);
      } else {
        expect(source).toContain("status.latestCreatedRevisionName");
        expect(source).not.toContain("status.latestReadyRevisionName");
        expect(source).toContain(
          'PREVIEW_RUNTIME_SUFFIX="pr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"'
        );
        expect(source).toContain('--image "$PREVIEW_DEPLOY_IMAGE"');
        expect(source).toContain("--no-traffic");
        expect(source).toContain('--revision-suffix "$PREVIEW_RUNTIME_SUFFIX"');
        expect(source).toContain(
          'gcloud run revisions describe "$PREVIEW_RUNTIME_REVISION"'
        );
        expect(source).toContain(
          'PREVIEW_RUNTIME_IMAGE" != "$PREVIEW_DEPLOY_IMAGE"'
        );
        expect(source).toContain('PREVIEW_RUNTIME_READY" != "True"');
      }
    }
  );

  it("persists the OpenClaw OIDC heartbeat configuration on every production revision", () => {
    const source = readFileSync(
      join(process.cwd(), ".github/workflows/firebase-hosting-merge.yml"),
      "utf8"
    );

    const audienceFallback = source.indexOf(
      'HEARTBEAT_OIDC_AUDIENCES="$SERVICE_URL"'
    );
    const audienceUpdate = source.indexOf(
      'append_env_update "OPENCLAW_HEARTBEAT_OIDC_AUDIENCES" "$HEARTBEAT_OIDC_AUDIENCES"'
    );
    const publisherUpdate = source.indexOf(
      'append_env_update "OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS" "$OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS"'
    );
    const runtimeUpdate = source.indexOf(
      'append_env_update "OPENCLAW_HEARTBEAT_RUNTIME_ID" "$OPENCLAW_HEARTBEAT_RUNTIME_ID"'
    );
    const revisionUpdate = source.indexOf(
      'gcloud run services update "$FIREBASE_SSR_SERVICE"'
    );

    expect(source).toContain(
      "openclaw-gateway@vibecheck-ik969.iam.gserviceaccount.com"
    );
    expect(source).toContain(
      "OPENCLAW_HEARTBEAT_RUNTIME_ID: ${{ vars.OPENCLAW_HEARTBEAT_RUNTIME_ID || 'openclaw-gateway' }}"
    );
    expect(audienceFallback).toBeGreaterThan(-1);
    expect(audienceUpdate).toBeGreaterThan(audienceFallback);
    expect(publisherUpdate).toBeGreaterThan(audienceUpdate);
    expect(runtimeUpdate).toBeGreaterThan(publisherUpdate);
    expect(revisionUpdate).toBeGreaterThan(runtimeUpdate);
  });

  it("pins the exact revenue OIDC contract and timeout on every production candidate", () => {
    const source = readFileSync(
      join(process.cwd(), ".github/workflows/firebase-hosting-merge.yml"),
      "utf8"
    );

    const serviceUrlLookup = source.indexOf(
      'SERVICE_URL="$(gcloud run services describe "$FIREBASE_SSR_SERVICE"'
    );
    const canonicalServiceAccount = source.indexOf(
      'EXPECTED_REVENUE_SCHEDULER_SERVICE_ACCOUNT="revenue-automation-scheduler@${FIREBASE_PROJECT_ID}.iam.gserviceaccount.com"'
    );
    const audienceDerivation = source.indexOf(
      'REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE="$SERVICE_URL"'
    );
    const schedulerUpdate = source.indexOf(
      'append_env_update "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL"'
    );
    const audienceUpdate = source.indexOf(
      'append_env_update "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE"'
    );
    const uidUpdate = source.indexOf(
      'append_env_update "REVENUE_AUTOMATION_UID"'
    );
    const legacyFlagUpdate = source.indexOf(
      'append_env_update "REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN"'
    );
    const revisionUpdate = source.indexOf(
      'gcloud run services update "$FIREBASE_SSR_SERVICE"'
    );
    const revisionState = source.indexOf(
      'RUNTIME_REVISION_STATE="$(gcloud run revisions describe'
    );
    const exactVerification = source.indexOf(
      'Runtime revision failed the exact revenue OIDC configuration contract.'
    );
    const candidateTag = source.indexOf(
      '--update-tags="$RELEASE_TAG=$RUNTIME_REVISION"'
    );

    expect(source).toContain(
      "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL: ${{ vars.REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL || '' }}"
    );
    expect(source).toContain(
      "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE: ${{ vars.REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE || '' }}"
    );
    expect(source).toContain(
      "REVENUE_AUTOMATION_UID: ${{ secrets.REVENUE_AUTOMATION_UID || '' }}"
    );
    expect(source).toContain(
      "REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN: ${{ vars.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN || 'true' }}"
    );
    expect(source).toContain(
      '[[ ! "$SERVICE_URL" =~ ^https://[a-z0-9.-]+\\.run\\.app$ ]]'
    );
    expect(source).toContain(
      '[ "$REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE" != "$SERVICE_URL" ]'
    );
    expect(source).toContain(
      '[ "$REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL" != "$EXPECTED_REVENUE_SCHEDULER_SERVICE_ACCOUNT" ]'
    );
    expect(source).toContain(
      'if [ -z "$REVENUE_AUTOMATION_UID" ]; then'
    );
    expect(source).toContain("--timeout 900s");
    expect(source).toContain(
      'RUNTIME_TIMEOUT_SECONDS="$(jq -r \'.spec.timeoutSeconds // empty | tostring\''
    );
    expect(source).toContain('[ "$RUNTIME_TIMEOUT_SECONDS" != "900" ]');
    expect(source).not.toContain("echo \"$REVENUE_AUTOMATION_UID\"");

    expect(serviceUrlLookup).toBeGreaterThan(-1);
    expect(canonicalServiceAccount).toBeGreaterThan(serviceUrlLookup);
    expect(audienceDerivation).toBeGreaterThan(canonicalServiceAccount);
    expect(schedulerUpdate).toBeGreaterThan(audienceDerivation);
    expect(audienceUpdate).toBeGreaterThan(schedulerUpdate);
    expect(uidUpdate).toBeGreaterThan(audienceUpdate);
    expect(legacyFlagUpdate).toBeGreaterThan(uidUpdate);
    expect(revisionUpdate).toBeGreaterThan(legacyFlagUpdate);
    expect(revisionState).toBeGreaterThan(revisionUpdate);
    expect(exactVerification).toBeGreaterThan(revisionState);
    expect(candidateTag).toBeGreaterThan(exactVerification);
  });

  it("removes and verifies every legacy revenue token mapping only after final cutover", () => {
    const source = readFileSync(
      join(process.cwd(), ".github/workflows/firebase-hosting-merge.yml"),
      "utf8"
    );
    const legacyNames = [
      "REVENUE_AUTOMATION_LEGACY_WORKER_TOKEN",
      "REVENUE_DAY1_WORKER_TOKEN",
      "REVENUE_DAY2_WORKER_TOKEN",
      "REVENUE_DAY30_WORKER_TOKEN",
      "REVENUE_POS_WORKER_TOKEN",
      "REVENUE_WEEKLY_KPI_WORKER_TOKEN",
    ];

    const finalCutover = source.indexOf(
      'if [ "$REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN" = "false" ]; then'
    );
    const valueRemoval = source.indexOf(
      'RUNTIME_CONFIG_ARGS+=("--remove-env-vars=$REMOVE_ENV_CSV")'
    );
    const secretRemoval = source.indexOf(
      'RUNTIME_CONFIG_ARGS+=("--remove-secrets=$REMOVE_SECRET_CSV")'
    );
    const revisionUpdate = source.indexOf(
      'gcloud run services update "$FIREBASE_SSR_SERVICE"'
    );
    const absenceVerification = source.indexOf(
      "Runtime revision still contains a legacy revenue token mapping."
    );

    for (const name of legacyNames) {
      expect(source).toContain(`            ${name}`);
    }
    expect(source).toContain(
      '.spec.template.spec.containers[0].env[]? | select(.name == $name and .valueFrom != null)'
    );
    expect(source).toContain(
      '.spec.containers[0].env[]? | select(.name == $name)'
    );
    expect(finalCutover).toBeGreaterThan(-1);
    expect(valueRemoval).toBeGreaterThan(finalCutover);
    expect(secretRemoval).toBeGreaterThan(valueRemoval);
    expect(revisionUpdate).toBeGreaterThan(secretRemoval);
    expect(absenceVerification).toBeGreaterThan(revisionUpdate);
    expect(source).toContain(
      "REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN: ${{ vars.REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN || 'true' }}"
    );
    expect(source).toContain('--remove-tags="$REMOVE_TAGS_CSV"');
    expect(source).toContain(
      'select(.tag != null and .tag != $keep) | .tag'
    );
    expect(source).toContain('LEGACY_PUBLIC_TAG_COUNT" != "0"');
    expect(source.indexOf('--remove-tags="$REMOVE_TAGS_CSV"')).toBeGreaterThan(
      source.indexOf("hosting:clone")
    );
  });

  it("checks the deployed control-plane knowledge pack and removes its synthetic user", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/post-deploy-smoke.mjs"),
      "utf8"
    );

    expect(source).toContain("/api/agents/control-plane");
    expect(source).toContain('skill?.id === "knowledge_pack_v2"');
    expect(source).toContain('knowledgePack?.state === "operational"');
    expect(source).toContain("await auth.deleteUser(uid)");
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
