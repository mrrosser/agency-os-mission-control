import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

function createRequest() {
  return new Request("http://localhost/api/health", { method: "GET" });
}

function createContext() {
  // Next route handlers always receive a 2nd arg with `params`.
  return { params: Promise.resolve({}) };
}

describe("health endpoint", () => {
  it("returns ok status", async () => {
    const response = await GET(
      createRequest() as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
  });
});
