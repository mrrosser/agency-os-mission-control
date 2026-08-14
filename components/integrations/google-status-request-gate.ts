export interface LatestRequestGate {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
}

export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(requestId) {
      return requestId === generation;
    },
  };
}
