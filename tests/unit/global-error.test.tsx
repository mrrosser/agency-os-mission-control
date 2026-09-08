import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";

describe("global workspace recovery", () => {
  it("renders useful recovery without exposing the exception or loading auth", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("private deployment details")} reset={() => undefined} />);
    expect(html).toContain("Reload workspace");
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("private deployment details");
  });
});
