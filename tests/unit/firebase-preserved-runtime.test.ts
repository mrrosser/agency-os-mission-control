import { describe, expect, it } from "vitest";
import {
  SECOND_BRAIN_SECRET_REFERENCES,
  replaceProviderSendDotenvFlag,
  secondBrainUpdateSecrets,
  snapshotSecondBrainReferences,
  validateProviderSendFlag,
  verifyPreservedRuntime,
} from "../../scripts/firebase-preserved-runtime.mjs";

type RuntimeEnv = { name: string; value?: string; valueFrom?: { secretKeyRef: { name: string; key: string } } };

function revision(flag = "false") {
  return {
    spec: {
      containers: [{
        env: [
          ...Object.entries(SECOND_BRAIN_SECRET_REFERENCES).map(([name, secret]) => ({
            name, valueFrom: { secretKeyRef: { name: secret, key: "latest" } },
          })),
          { name: "WARM_RECONNECT_PROVIDER_SEND_ENABLED", value: flag },
          { name: "UNRELATED_SECRET", value: "must-never-appear-in-snapshot" },
        ] as RuntimeEnv[],
      }],
    },
  };
}

describe("preserved Firebase runtime configuration", () => {
  it("captures exactly five approved references and never unrelated environment values", () => {
    const snapshot = snapshotSecondBrainReferences(revision());
    expect(snapshot.bindings).toHaveLength(5);
    expect(JSON.stringify(snapshot)).not.toContain("must-never-appear");
    expect(JSON.stringify(snapshot)).not.toContain("UNRELATED_SECRET");
    expect(secondBrainUpdateSecrets(snapshot)).toBe(Object.entries(SECOND_BRAIN_SECRET_REFERENCES)
      .map(([name, secret]) => `${name}=${secret}:latest`).join(","));
  });

  it.each(["true", "false"])("verifies the exact runtime flag %s", (flag) => {
    expect(verifyPreservedRuntime(revision(flag), snapshotSecondBrainReferences(revision()), flag)).toBe(true);
  });

  it.each(["TRUE", "False", " true", "false\n", "", "yes", undefined, true])("rejects nonliteral send flag %s", (flag) => {
    expect(() => validateProviderSendFlag(flag)).toThrow("exactly true or false");
  });

  it("rejects missing, duplicate, literal, renamed and repinned secret bindings", () => {
    const missing = revision();
    missing.spec.containers[0].env.shift();
    expect(() => snapshotSecondBrainReferences(missing)).toThrow("SECOND_BRAIN_SERVICE_TOKEN");
    const duplicate = revision();
    duplicate.spec.containers[0].env.push(duplicate.spec.containers[0].env[0]);
    expect(() => snapshotSecondBrainReferences(duplicate)).toThrow("SECOND_BRAIN_SERVICE_TOKEN");
    const literal = revision();
    Object.assign(literal.spec.containers[0].env[0], { value: "do-not-print-this" });
    expect(() => snapshotSecondBrainReferences(literal)).toThrow("SECOND_BRAIN_SERVICE_TOKEN");
    try { snapshotSecondBrainReferences(literal); } catch (error) { expect(String(error)).not.toContain("do-not-print-this"); }
    for (const patch of [{ name: "wrong-secret" }, { key: "42" }]) {
      const changed = revision();
      Object.assign(changed.spec.containers[0].env[0].valueFrom!.secretKeyRef, patch);
      expect(() => snapshotSecondBrainReferences(changed)).toThrow("SECOND_BRAIN_SERVICE_TOKEN");
    }
  });

  it("rejects a tampered snapshot and preview send activation", () => {
    const snapshot = snapshotSecondBrainReferences(revision());
    expect(() => verifyPreservedRuntime(revision("true"), snapshot, "false")).toThrow("provider-send flag");
    Object.assign(snapshot.bindings[0], { secret: "wrong" });
    expect(() => secondBrainUpdateSecrets(snapshot)).toThrow("five approved bindings");
  });

  it("rejects multiple containers and duplicate or absent send flags", () => {
    const multiple = revision();
    multiple.spec.containers.push(multiple.spec.containers[0]);
    expect(() => snapshotSecondBrainReferences(multiple)).toThrow("single-container");
    const missingFlag = revision();
    const snapshot = snapshotSecondBrainReferences(missingFlag);
    missingFlag.spec.containers[0].env = missingFlag.spec.containers[0].env.filter((entry) => entry.name !== "WARM_RECONNECT_PROVIDER_SEND_ENABLED");
    expect(() => verifyPreservedRuntime(missingFlag, snapshot, "false")).toThrow("provider-send flag");
    const duplicateFlag = revision();
    duplicateFlag.spec.containers[0].env.push({ name: "WARM_RECONNECT_PROVIDER_SEND_ENABLED", value: "false" });
    expect(() => verifyPreservedRuntime(duplicateFlag, snapshot, "false")).toThrow("provider-send flag");
  });

  it("pins framework discovery even when ENV_LOCAL contains duplicate or exported overrides", () => {
    const text = "KEEP_ME=unchanged\r\nWARM_RECONNECT_PROVIDER_SEND_ENABLED=true\r\nexport WARM_RECONNECT_PROVIDER_SEND_ENABLED = true\r\n";
    const result = replaceProviderSendDotenvFlag(text, "false");
    expect(result).toBe("KEEP_ME=unchanged\nWARM_RECONNECT_PROVIDER_SEND_ENABLED=false\n");
    expect(replaceProviderSendDotenvFlag(result, "false")).toBe(result);
  });
});
