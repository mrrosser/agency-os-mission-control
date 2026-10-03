import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { assertDefaultNextRootDirectory } from "../../scripts/eslint-next-root-boundary.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

// Captured from the unmodified release configuration for TSX, API and library
// files. Compare severities/options, not just a rule count or plugin availability.
const expectedNextRules = {
  "@next/next/google-font-display": [1],
  "@next/next/google-font-preconnect": [1],
  "@next/next/next-script-for-ga": [1],
  "@next/next/no-async-client-component": [1],
  "@next/next/no-before-interactive-script-outside-document": [1],
  "@next/next/no-css-tags": [1],
  "@next/next/no-head-element": [1],
  "@next/next/no-html-link-for-pages": [2],
  "@next/next/no-img-element": [1],
  "@next/next/no-page-custom-font": [1],
  "@next/next/no-styled-jsx-in-document": [1],
  "@next/next/no-sync-scripts": [2],
  "@next/next/no-title-in-document-head": [1],
  "@next/next/no-typos": [1],
  "@next/next/no-unwanted-polyfillio": [1],
  "@next/next/inline-script-id": [2],
  "@next/next/no-assign-module-variable": [2],
  "@next/next/no-document-import-in-page": [2],
  "@next/next/no-duplicate-head": [2],
  "@next/next/no-head-import-in-document": [2],
  "@next/next/no-script-component-in-head": [2],
};

function configuredRoot(rootDir: unknown) {
  return { settings: { next: { rootDir } } };
}

interface LockedPackage {
  name?: string;
  version?: string;
  resolved?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("application-scoped Next lint dependency boundary", () => {
  it("accepts the default cwd contract without modifying the final configuration", () => {
    const config = [{ rules: expectedNextRules }, [{ settings: { next: {} } }]];
    expect(assertDefaultNextRootDirectory(config)).toBe(config);
    expect(config[0]).toEqual({ rules: expectedNextRules });
  });

  it.each([
    { label: "string glob", config: [configuredRoot("apps/*")] },
    { label: "directory array", config: [configuredRoot(["apps/web", "apps/docs"])] },
    { label: "explicit undefined", config: [configuredRoot(undefined)] },
    {
      label: "inherited rootDir",
      config: [{ settings: { next: Object.create({ rootDir: "apps/*" }) as Record<string, unknown> } }],
    },
    {
      label: "inherited next settings",
      config: [{ settings: Object.create({ next: { rootDir: "apps/web" } }) as Record<string, unknown> }],
    },
    {
      label: "later nested FlatCompat entry",
      config: [{ rules: expectedNextRules }, [[{ settings: { next: {} } }, [configuredRoot("apps/**")]]]],
    },
  ])("fails explicitly for $label instead of changing glob semantics", ({ config }) => {
    expect(() => assertDefaultNextRootDirectory(config)).toThrow(
      /settings\.next\.rootDir requires a reviewed glob migration.*docs\/reports\/2026-10-03-dependency-repair\.md/,
    );
  });

  it("preserves all 21 enabled Next rules and exact severities in TSX, API and library configurations", async () => {
    const eslint = new ESLint({
      cwd: projectRoot,
      overrideConfigFile: join(projectRoot, "eslint.config.mjs"),
    });
    for (const filePath of [
      "app/page.tsx",
      "app/api/crm/warm-reconnect/activation/route.ts",
      "lib/crm/warm-reconnect-activation.ts",
    ]) {
      const config = await eslint.calculateConfigForFile(filePath);
      expect(config, `${filePath} must remain covered by lint`).toBeDefined();
      const enabled = Object.fromEntries(
        Object.entries(config.rules || {}).filter(([name, value]) => {
          const severity = Array.isArray(value) ? value[0] : value;
          return name.startsWith("@next/next/") && severity !== 0 && severity !== "off";
        }),
      );
      expect(Object.keys(enabled), filePath).toHaveLength(21);
      expect(enabled, filePath).toEqual(expectedNextRules);
      const nextSettings = config.settings?.next;
      expect(nextSettings && typeof nextSettings === "object" && "rootDir" in nextSettings)
        .toBeFalsy();
    }
  }, 20_000);

  it("still reports internal raw anchors and permits Next Link under the actual default-cwd rule", async () => {
    const tempRoot = realpathSync(tmpdir());
    const prefix = "rt-next-eslint-boundary-";
    const fixture = mkdtempSync(join(tempRoot, prefix));
    try {
      mkdirSync(join(fixture, "pages"));
      writeFileSync(join(fixture, "pages", "about.jsx"), "export default function About() { return null; }\n");
      const nextPlugin = require("@next/eslint-plugin-next") as NonNullable<Linter.Config["plugins"]>[string];
      const eslint = new ESLint({
        cwd: fixture,
        overrideConfigFile: true,
        overrideConfig: {
          files: ["**/*.jsx"],
          languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { "@next/next": nextPlugin },
          rules: { "@next/next/no-html-link-for-pages": "error" },
        },
      });
      const options = { filePath: join(fixture, "pages", "index.jsx") };
      const [invalid] = await eslint.lintText(
        'export default function Page() { return <a href="/about/">About</a>; }',
        options,
      );
      expect(invalid.fatalErrorCount).toBe(0);
      expect(invalid.messages).toEqual([
        expect.objectContaining({ ruleId: "@next/next/no-html-link-for-pages", severity: 2 }),
      ]);
      for (const source of [
        'import Link from "next/link"; export default function Page() { return <Link href="/about/">About</Link>; }',
        'export default function Page() { return <a href="https://example.com/about/">External</a>; }',
      ]) {
        const [valid] = await eslint.lintText(source, options);
        expect(valid.fatalErrorCount).toBe(0);
        expect(valid.messages).toEqual([]);
      }
    } finally {
      // Validate the resolved target before any recursive Windows cleanup.
      const target = resolve(fixture);
      const insideTemp = relative(tempRoot, target);
      if (!insideTemp || insideTemp.startsWith("..") || isAbsolute(insideTemp) || !basename(target).startsWith(prefix)) {
        throw new Error("Refusing fixture cleanup outside the owned temporary directory");
      }
      rmSync(target, { recursive: true, force: true });
    }
    expect(existsSync(fixture)).toBe(false);
  }, 20_000);

  it("limits the real tinyglobby replacement to the inspected Next consumer and removes the vulnerable chain", () => {
    const manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(projectRoot, "package-lock.json"), "utf8")) as {
      packages: Record<string, LockedPackage>;
    };
    expect(manifest.overrides["@next/eslint-plugin-next@15.5.25"]).toEqual({
      "fast-glob": "npm:tinyglobby@0.2.17",
    });
    expect(manifest.overrides["fast-glob"]).toBeUndefined();
    const entries = Object.entries(lock.packages);
    const consumers = entries.filter(([, pkg]) =>
      [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies]
        .some((dependencies) => dependencies && "fast-glob" in dependencies),
    );
    expect(consumers.map(([name]) => name), "A new fast-glob consumer needs its own reviewed compatibility decision")
      .toEqual(["node_modules/@next/eslint-plugin-next"]);
    expect(consumers[0][1].version).toBe("15.5.25");
    const aliases = entries.filter(([name]) => /(?:^|\/)node_modules\/fast-glob$/.test(name));
    expect(aliases).toHaveLength(1);
    expect(aliases[0][1]).toMatchObject({
      name: "tinyglobby",
      version: "0.2.17",
      resolved: "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
    });
    const vulnerableChain = entries.filter(([name, pkg]) =>
      /(?:^|\/)node_modules\/(?:braces|micromatch)$/.test(name) ||
      pkg.name === "braces" || pkg.name === "micromatch",
    );
    expect(vulnerableChain, "The unpatched braces/micromatch chain must not return under another dependency")
      .toEqual([]);
  });
});
