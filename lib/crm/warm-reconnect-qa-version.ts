/** Fixed, separately authorized tests. This is not a caller-extensible campaign ID. */
export const WARM_RECONNECT_QA_ORIGINAL_TEST_ID = "gallery-owner-single-test-2026-10-04" as const;
export const WARM_RECONNECT_QA_REVISED_TEST_ID = "gallery-owner-design-v2-2026-10-05" as const;
export type WarmReconnectQaTestId = typeof WARM_RECONNECT_QA_ORIGINAL_TEST_ID | typeof WARM_RECONNECT_QA_REVISED_TEST_ID;

export function isWarmReconnectQaTestId(value: unknown): value is WarmReconnectQaTestId {
  return value === WARM_RECONNECT_QA_ORIGINAL_TEST_ID || value === WARM_RECONNECT_QA_REVISED_TEST_ID;
}

export function warmReconnectQaVersion(testId: WarmReconnectQaTestId) {
  if (testId === WARM_RECONNECT_QA_ORIGINAL_TEST_ID) return {
    testId, label: "Original owner test — October 4", designVersion: "preference-buttons-original",
    subject: "[TEST] A quick hello from Marcus",
  } as const;
  if (testId === WARM_RECONNECT_QA_REVISED_TEST_ID) return {
    testId, label: "Revised design owner test — October 5", designVersion: "rosser-rt-library-kit-v1",
    subject: "[TEST · revised design] A quick hello from Marcus",
  } as const;
  throw new Error("Unknown owner test version");
}
