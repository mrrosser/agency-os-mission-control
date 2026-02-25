import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    targetRoot: process.env.AI_HELL_MARY_ROOT || "C:\\CTO Projects\\AI_HELL_MARY",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if ((token === "--target-root" || token === "-t") && argv[i + 1]) {
      options.targetRoot = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return options;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content, dryRun) {
  if (dryRun) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const targetRoot = path.resolve(args.targetRoot);

  if (!fs.existsSync(targetRoot)) {
    throw new Error(`Target root does not exist: ${targetRoot}`);
  }

  const copies = [
    {
      sourceRelative: path.join("please-review", "from-root", "config-templates", "knowledge-pack.v2.json"),
      targetRelative: path.join("docs", "generated", "mission-control", "knowledge-pack.v2.json"),
    },
    {
      sourceRelative: path.join("docs", "plans", "2026-02-24-square-catalog-import.csv"),
      targetRelative: path.join("docs", "generated", "mission-control", "square-catalog-import.csv"),
    },
    {
      sourceRelative: path.join("docs", "plans", "2026-02-24-weekly-kpi-loop.md"),
      targetRelative: path.join("docs", "generated", "mission-control", "weekly-kpi-loop.md"),
    },
    {
      sourceRelative: path.join("docs", "execplans", "2026-02-24-dual-business-revenue-activation.md"),
      targetRelative: path.join("docs", "generated", "mission-control", "dual-business-revenue-activation.md"),
    },
  ];

  const copied = [];
  for (const entry of copies) {
    const sourcePath = path.resolve(repoRoot, entry.sourceRelative);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing source file: ${sourcePath}`);
    }

    const content = readText(sourcePath);
    const targetPath = path.resolve(targetRoot, entry.targetRelative);
    writeText(targetPath, content, args.dryRun);

    copied.push({
      sourceRelative: entry.sourceRelative.replace(/\\/g, "/"),
      targetRelative: entry.targetRelative.replace(/\\/g, "/"),
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: sha256(content),
    });

    console.log(`[sync] ${entry.sourceRelative} -> ${path.relative(targetRoot, targetPath)}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceRoot: repoRoot,
    targetRoot,
    dryRun: args.dryRun,
    files: copied,
  };

  const manifestRelative = path.join("docs", "generated", "mission-control", "sync-manifest.json");
  const manifestPath = path.resolve(targetRoot, manifestRelative);
  writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, args.dryRun);

  console.log(`[sync] manifest -> ${manifestRelative.replace(/\\/g, "/")}`);
  console.log(`[sync] completed (${args.dryRun ? "dry-run" : "write"})`);
}

main();
