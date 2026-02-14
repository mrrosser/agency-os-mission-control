import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configurePlacesPhotoClient,
  getPlacesPhotoBlob,
  resetPlacesPhotoClientForTests,
} from "@/lib/google/places-photo-client";

const mockFetch = vi.fn();

describe("places photo client", () => {
  beforeEach(() => {
    resetPlacesPhotoClientForTests();
    mockFetch.mockReset();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  });

  it("dedupes concurrent requests for the same photo", async () => {
    const blob = new Blob(["img"], { type: "image/jpeg" });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });

    const [a, b] = await Promise.all([
      getPlacesPhotoBlob({ photoRef: "ref-1", maxWidth: 240, idToken: "token", correlationId: "c1" }),
      getPlacesPhotoBlob({ photoRef: "ref-1", maxWidth: 240, idToken: "token", correlationId: "c2" }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(blob);
    expect(b).toBe(blob);

    const again = await getPlacesPhotoBlob({ photoRef: "ref-1", maxWidth: 240, idToken: "token", correlationId: "c3" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(again).toBe(blob);
  });

  it("caps concurrent fetches", async () => {
    configurePlacesPhotoClient({ concurrency: 2 });

    let inProgress = 0;
    let maxInProgress = 0;
    const deferred: Array<() => void> = [];

    mockFetch.mockImplementation(() => {
      inProgress += 1;
      maxInProgress = Math.max(maxInProgress, inProgress);

      return new Promise((resolve) => {
        deferred.push(() => {
          inProgress = Math.max(0, inProgress - 1);
          resolve({
            ok: true,
            blob: async () => new Blob(["img"], { type: "image/jpeg" }),
          });
        });
      });
    });

    const promises = Array.from({ length: 6 }, (_, idx) =>
      getPlacesPhotoBlob({
        photoRef: `ref-${idx}`,
        maxWidth: 240,
        idToken: "token",
        correlationId: `c${idx}`,
      })
    );

    // Let the first wave of fetches start.
    await new Promise((r) => setTimeout(r, 0));
    expect(maxInProgress).toBeLessThanOrEqual(2);

    while (deferred.length > 0) {
      const next = deferred.shift();
      if (next) next();
      // Yield so queued requests can acquire a slot and call fetch.
      await new Promise((r) => setTimeout(r, 0));
    }

    await Promise.all(promises);
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(maxInProgress).toBeLessThanOrEqual(2);
  });
});
