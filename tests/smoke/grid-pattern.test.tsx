import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GridPattern } from "@/components/magicui/grid-pattern";

describe("grid pattern smoke", () => {
    it("renders default markup without crashing", () => {
        const markup = renderToStaticMarkup(<GridPattern />);
        expect(markup).toContain("<svg");
    });
});
