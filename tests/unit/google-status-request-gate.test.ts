import { describe, expect, it } from "vitest";
import { createLatestRequestGate } from "@/components/integrations/google-status-request-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Google status latest-request gate", () => {
  it("ignores a delayed user-A response after user B becomes current", async () => {
    const gate = createLatestRequestGate();
    const userA = deferred<string>();
    const userB = deferred<string>();
    let applied = "none";

    const load = async (response: Promise<string>) => {
      const requestId = gate.begin();
      const value = await response;
      if (gate.isCurrent(requestId)) applied = value;
    };
    const loadA = load(userA.promise);
    const loadB = load(userB.promise);

    userB.resolve("user-b");
    await loadB;
    userA.resolve("user-a");
    await loadA;

    expect(applied).toBe("user-b");
  });

  it("ignores a delayed response after logout invalidates the request", async () => {
    const gate = createLatestRequestGate();
    const userA = deferred<string>();
    let applied = "disconnected";
    const requestId = gate.begin();
    const loadA = userA.promise.then((value) => {
      if (gate.isCurrent(requestId)) applied = value;
    });

    gate.invalidate();
    userA.resolve("user-a");
    await loadA;

    expect(applied).toBe("disconnected");
  });
});
