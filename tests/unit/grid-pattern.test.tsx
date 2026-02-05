import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GridPattern } from "@/components/magicui/grid-pattern";

describe("GridPattern", () => {
    it("renders the SVG pattern definition", () => {
        const markup = renderToStaticMarkup(
            <GridPattern width={32} height={32} strokeDasharray="4 2" />,
        );

        expect(markup).toContain("<pattern");
        expect(markup).toContain("stroke-dasharray");
    });

    it("renders highlight squares when provided", () => {
        const markup = renderToStaticMarkup(
            <GridPattern squares={[[1, 2], [3, 4]]} />,
        );

        const rects = markup.match(/<rect/g) ?? [];
        expect(rects.length).toBeGreaterThan(1);
    });
});
