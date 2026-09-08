import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  FIRST_PARTY_SHARE_CARDS,
  buildFirstPartyShareActionData,
  buildFirstPartyVCard,
  escapeVCardText,
  getFirstPartyShareCard,
  shareFirstPartyCard,
  type FirstPartyShareActionData,
} from "@/lib/crm/share-cards";
import { SHARE_CARD_PRIVATE_SYNC_STATUS } from "@/lib/crm/share-card-private-metadata";
import { FirstPartyShareCards } from "@/components/crm/first-party-share-cards";
import { FirstPartyShareActions } from "@/components/crm/first-party-share-actions";
import PublicContactCard from "@/app/connect/[brand]/page";

const PUBLIC_ACTION_KEYS = ["brand", "liveUrl", "name", "person", "qrPath", "vcardPath"];

function findPublicActionProps(node: ReactNode): FirstPartyShareActionData[] {
  if (!isValidElement<{ card?: FirstPartyShareActionData; children?: ReactNode }>(node)) return [];
  if (node.type === FirstPartyShareActions && node.props.card) return [node.props.card];
  return Children.toArray(node.props.children).flatMap(findPublicActionProps);
}

/** Resolve actual local imports/re-exports/dynamic imports without building .next. */
function localModuleGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  function visit(filename: string) {
    if (seen.has(filename)) return;
    const source = readFileSync(filename, "utf8");
    seen.set(filename, source);
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function inspect(node: ts.Node) {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        specifier = node.arguments[0].text;
      }
      if (specifier && (specifier.startsWith("@/") || specifier.startsWith(".")) && !specifier.endsWith(".css")) {
        const base = specifier.startsWith("@/") ? resolve(specifier.slice(2)) : resolve(dirname(filename), specifier);
        const dependency = [base + ".ts", base + ".tsx", base + ".js", base + ".mjs", resolve(base, "index.ts"), resolve(base, "index.tsx")].find(existsSync);
        expect(dependency, `Resolve local dependency ${specifier} from ${filename}`).toBeDefined();
        if (dependency) visit(dependency);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
  }
  visit(resolve(entry));
  return seen;
}

describe("first-party share cards", () => {
  it("limits cards to the two named businesses and uses current live intake destinations", () => {
    expect(FIRST_PARTY_SHARE_CARDS.map((card) => card.liveUrl)).toEqual([
      "https://rossergallery.com/qr", "https://rt.solutions/contact",
    ]);
    expect(getFirstPartyShareCard("not-a-business")).toBeUndefined();
    expect(getFirstPartyShareCard("__proto__")).toBeUndefined();
    for (const card of FIRST_PARTY_SHARE_CARDS) {
      expect(card.liveUrl).not.toContain("leadflow");
      expect(card.liveUrl).not.toContain("/connect/");
      expect(readFileSync(resolve("public", card.qrPath.slice(1))).subarray(1, 4).toString()).toBe("PNG");
    }
  });

  it("uses correct branded contact details without invented phone numbers", () => {
    for (const card of FIRST_PARTY_SHARE_CARDS) {
      const actual = readFileSync(resolve("public", card.vcardPath.slice(1)), "utf8").replace(/\r\n/g, "\n");
      const expected = buildFirstPartyVCard(card).replace(/\r\n/g, "\n");
      expect(actual).toBe(expected);
      expect(actual).not.toMatch(/^TEL[;:]/m);
      expect(actual).toContain("Saving this contact does not subscribe you");
      expect(actual).toContain(`ORG:${card.name}`);
      expect(actual).toContain(`WORK:${card.email}`);
    }
    expect(escapeVCardText("Hello,\nA;B\\C")).toBe("Hello\\,\\nA\\;B\\\\C");
  });

  it("shares only the live intake link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[0], { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://rossergallery.com/qr" }));
  });

  it("falls back to copying when native share is unavailable or fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[1], { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://rt.solutions/contact");
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[1], { share: vi.fn().mockRejectedValue(new Error("unavailable")), clipboard: { writeText } })).toBe("copied");
  });

  it("does not copy after share cancellation", async () => {
    const error = new Error("cancelled");
    error.name = "AbortError";
    const writeText = vi.fn();
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[0], { share: vi.fn().mockRejectedValue(error), clipboard: { writeText } })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("keeps a manual-copy path when browser clipboard is denied", async () => {
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[0], {})).toBe("manual");
    expect(await shareFirstPartyCard(FIRST_PARTY_SHARE_CARDS[0], { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }, false)).toBe("manual");
  });

  it("shows the actual sync gaps in the private workbench", () => {
    const html = renderToStaticMarkup(<FirstPartyShareCards />);
    expect(html).toContain("Current submission-to-CRM receipts still need verification");
    expect(html).toContain("automatic internal CRM bridge is not built yet");
    expect(html).toContain("Open public contact card");
    expect(html).not.toMatch(/local review candidate|not published replacements|local candidate/i);
    expect(html).toContain("does not collect the visitor");
  });

  it("separates private operational metadata from public card data and runtime action props", () => {
    for (const card of FIRST_PARTY_SHARE_CARDS) {
      const contaminated = { ...card, syncStatus: "private-sentinel", subscriberCount: 42 };
      const actionData = buildFirstPartyShareActionData(contaminated);
      expect(Object.keys(actionData).sort()).toEqual(PUBLIC_ACTION_KEYS);
      expect(JSON.stringify(actionData)).not.toMatch(/syncStatus|subscriberCount|private-sentinel/);
      expect(JSON.stringify(card)).not.toContain(SHARE_CARD_PRIVATE_SYNC_STATUS[card.brand]);
      expect(card).not.toHaveProperty("syncStatus");
    }
  });

  it.each(["app/connect/[brand]/page.tsx", "components/crm/first-party-share-actions.tsx"])(
    "keeps private workspace modules and sync notes outside the public import graph for %s",
    (entry) => {
      const graph = localModuleGraph(entry);
      const sources = [...graph.values()].join("\n");
      expect([...graph.keys()].some((file) => file.endsWith("first-party-share-actions.tsx"))).toBe(true);
      expect([...graph.keys()].some((file) => file.endsWith("first-party-share-cards.tsx") || file.endsWith("share-card-private-metadata.ts"))).toBe(false);
      expect(sources).not.toMatch(/syncStatus|SHARE_CARD_PRIVATE_SYNC_STATUS|subscriberCount|auth-provider|firebase/);
      for (const note of Object.values(SHARE_CARD_PRIVATE_SYNC_STATUS)) expect(sources).not.toContain(note);
    },
  );

  it.each(FIRST_PARTY_SHARE_CARDS)("renders $name publicly without private CRM details or pretend form submission", async (card) => {
    const element = await PublicContactCard({ params: Promise.resolve({ brand: card.brand }) });
    // Server-to-client props, not only rendered text, must be public-safe.
    const clientProps = findPublicActionProps(element);
    expect(clientProps).toHaveLength(1);
    expect(Object.keys(clientProps[0]).sort()).toEqual(PUBLIC_ACTION_KEYS);
    const serializedProps = JSON.stringify(clientProps);
    expect(serializedProps).not.toMatch(/syncStatus|subscriberCount|CRM|Netlify/);
    for (const note of Object.values(SHARE_CARD_PRIVATE_SYNC_STATUS)) expect(serializedProps).not.toContain(note);
    const html = renderToStaticMarkup(element);
    expect(html).toContain(card.email);
    expect(html).toContain(card.liveUrl);
    expect(html).toContain("Saving this contact is just for your address book");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("CRM");
    expect(html).not.toContain("subscriberCount");
    expect(html).not.toContain("firebase");
    expect(html).not.toMatch(/local review candidate|local candidate/i);
    for (const social of card.socials) expect(html).toContain(social.href.replace(/&/g, "&amp;"));
  });
});
