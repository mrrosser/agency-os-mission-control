import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

function createRequest() {
  return new Request("http://localhost/api/health", { method: "GET" });
}

describe("health endpoint", () => {
  it("returns ok status", async () => {
    const response = await GET(createRequest() as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
  });
});
