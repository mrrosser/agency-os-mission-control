"use client";

type PlacesPhotoClientConfig = {
  concurrency: number;
  maxEntries: number;
};

const DEFAULT_CONFIG: PlacesPhotoClientConfig = {
  concurrency: 4,
  maxEntries: 64,
};

let config: PlacesPhotoClientConfig = { ...DEFAULT_CONFIG };

// Cache Blobs (not blob: URLs) so each component can safely create + revoke its own object URL.
const blobCache = new Map<string, Blob>(); // LRU via insertion order.
const inFlight = new Map<string, Promise<Blob>>();

let activeFetches = 0;
const waitQueue: Array<() => void> = [];

function cacheKey(photoRef: string, maxWidth: number): string {
  return `${maxWidth}:${photoRef}`;
}

function touchCache(key: string, blob: Blob): void {
  if (blobCache.has(key)) blobCache.delete(key);
  blobCache.set(key, blob);

  while (blobCache.size > config.maxEntries) {
    const oldest = blobCache.keys().next().value as string | undefined;
    if (!oldest) break;
    blobCache.delete(oldest);
  }
}

async function acquireSlot(): Promise<() => void> {
  if (activeFetches < config.concurrency) {
    activeFetches += 1;
    return () => {
      activeFetches = Math.max(0, activeFetches - 1);
      const next = waitQueue.shift();
      if (next) next();
    };
  }

  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeFetches += 1;
  return () => {
    activeFetches = Math.max(0, activeFetches - 1);
    const next = waitQueue.shift();
    if (next) next();
  };
}

export function configurePlacesPhotoClient(
  next: Partial<PlacesPhotoClientConfig>
): void {
  config = {
    concurrency: Math.max(1, Math.min(8, next.concurrency ?? config.concurrency)),
    maxEntries: Math.max(8, Math.min(256, next.maxEntries ?? config.maxEntries)),
  };
}

export function resetPlacesPhotoClientForTests(): void {
  config = { ...DEFAULT_CONFIG };
  blobCache.clear();
  inFlight.clear();
  activeFetches = 0;
  waitQueue.length = 0;
}

export async function getPlacesPhotoBlob(args: {
  photoRef: string;
  maxWidth: number;
  idToken: string;
  correlationId?: string;
}): Promise<Blob> {
  const photoRef = args.photoRef.trim();
  if (!photoRef) throw new Error("photoRef required");
  const maxWidth = Math.max(120, Math.min(1600, Math.round(args.maxWidth)));
  const key = cacheKey(photoRef, maxWidth);

  const cached = blobCache.get(key);
  if (cached) {
    touchCache(key, cached);
    return cached;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const release = await acquireSlot();
    try {
      const url = `/api/google/places/photo?ref=${encodeURIComponent(photoRef)}&maxWidth=${encodeURIComponent(
        String(maxWidth)
      )}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.idToken}`,
          "X-Correlation-Id": args.correlationId || crypto.randomUUID(),
        },
      });
      if (!res.ok) {
        throw new Error(`places photo fetch failed (${res.status})`);
      }
      const blob = await res.blob();
      touchCache(key, blob);
      return blob;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

