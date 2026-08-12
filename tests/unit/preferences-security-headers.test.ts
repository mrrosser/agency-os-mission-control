import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("public preference page security headers", () => {
  it("sets no-store, no-referrer, and HTTP frame protection", () => {
    for (const path of ["/preferences", "/preferences/"]) {
      const response = middleware(
        new NextRequest(`https://leadflow-review.web.app${path}`)
      );

      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0"
      );
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'"
      );
    }
  });

  it("does not apply recipient-page policy to authenticated dashboards", () => {
    const response = middleware(
      new NextRequest("https://leadflow-review.web.app/dashboard/crm")
    );

    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
