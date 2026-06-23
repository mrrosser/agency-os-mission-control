import { describe, expect, test } from "vitest";

const bootstrapModulePath = "../../scripts/bootstrap_socialops_storage_state.cjs";

type StorageStateCheck = {
  exists: boolean;
  ageHours: number | null;
};

type BootstrapStorageStateModule = {
  storageStateIsFresh: (check: StorageStateCheck, maxAgeHours: number) => boolean;
};

async function loadBootstrapModule() {
  return (await import(bootstrapModulePath)) as BootstrapStorageStateModule;
}

describe("bootstrap_socialops_storage_state helpers", () => {
  test("storageStateIsFresh returns false when missing", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: false, ageHours: null }, 24)).toBe(false);
  });

  test("storageStateIsFresh returns true when age under max", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: true, ageHours: 1 }, 24)).toBe(true);
  });

  test("storageStateIsFresh returns false when age over max", async () => {
    const mod = await loadBootstrapModule();
    expect(mod.storageStateIsFresh({ exists: true, ageHours: 25 }, 24)).toBe(false);
  });
});
