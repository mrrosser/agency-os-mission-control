import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { SourceMapConsumer, SourceNode, type RawSourceMap } from "source-map-js";

const requireHere = createRequire(import.meta.url);
type Trust = (address: string, hop: number) => boolean;
type ProxyRequest = { socket: { remoteAddress: string }; headers: Record<string, string> };
const proxyAddress = requireHere("proxy-addr") as {
  (request: ProxyRequest, trust: Trust): string;
  compile(subnets: string | string[]): Trust;
};

describe("patched runtime dependency contracts", () => {
  it("does not accept forwarded identity through a short IPv4-mapped trust prefix", () => {
    const request = {
      socket: { remoteAddress: "203.0.113.42" },
      headers: { "x-forwarded-for": "10.1.2.3" },
    };
    const trust = proxyAddress.compile("::ffff:10.0.0.0/8");
    expect(trust(request.socket.remoteAddress, 0)).toBe(false);
    expect(proxyAddress(request, trust)).toBe(request.socket.remoteAddress);
  });

  it("preserves explicitly trusted IPv4 and correctly mapped proxy subnets", () => {
    const request = {
      socket: { remoteAddress: "10.1.2.3" },
      headers: { "x-forwarded-for": "203.0.113.42" },
    };
    for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
      expect(proxyAddress(request, proxyAddress.compile(subnet))).toBe("203.0.113.42");
    }
  });

  it("stops exhausted indexed source maps without appending nonexistent source lines", () => {
    const code = "const answer = 42;\n";
    // The published synchronous API accepts indexed maps; its legacy typings
    // describe only a basic map. A small offset exercises the fix without load.
    const map = {
      version: 3,
      sections: [{
        offset: { line: 128, column: 0 },
        map: { version: 3, sources: ["input.js"], names: [], mappings: "AAAA", sourcesContent: [code] },
      }],
    } as unknown as RawSourceMap;
    const consumer = new SourceMapConsumer(map);
    const rendered = SourceNode.fromStringWithSourceMap(code, consumer);
    expect(rendered.toString()).toBe(code);
    expect(consumer.sourceContentFor("input.js")).toBe(code);
  });

  it("decodes and resizes SVG artwork through the installed sharp native binding", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#336699"/></svg>');
    const png = await sharp(svg).resize(16, 8).png().toBuffer();
    const metadata = await sharp(png).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 16, height: 8 });
    const pixel = await sharp(png).removeAlpha().raw().toBuffer();
    expect([...pixel.subarray(0, 3)]).toEqual([0x33, 0x66, 0x99]);
  });
});
