#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import process from "node:process";
import {
  buildRosserGalleryCardDryRun,
  RosserGalleryCardImportError,
} from "../lib/crm/rosser-gallery-card-import.ts";

function parseArguments(values) {
  if (values.length === 1 && !values[0].startsWith("-")) {
    return { file: values[0] };
  }
  const result = { file: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("--file=")) {
      result.file = value.slice("--file=".length);
      continue;
    }
    if (value === "--file" && values[index + 1]) {
      result.file = values[index + 1];
      index += 1;
      continue;
    }
    throw new Error("Only one local CSV path is supported. This command has no apply mode.");
  }
  if (!result.file) throw new Error("Provide a path for a local Dot contact CSV export.");
  return result;
}

const correlationId = randomUUID();

try {
  const arguments_ = parseArguments(process.argv.slice(2));
  const sourceBytes = await readFile(arguments_.file);
  const report = buildRosserGalleryCardDryRun({
    sourceBytes,
    sourceFileName: basename(arguments_.file),
  });
  process.stdout.write(
    `${JSON.stringify({
      event: "crm.rosser_gallery_card_import.dry_run_completed",
      correlationId,
      report,
    }, null, 2)}\n`
  );
} catch (error) {
  const known = error instanceof RosserGalleryCardImportError;
  process.stderr.write(
    `${JSON.stringify({
      event: "crm.rosser_gallery_card_import.dry_run_failed",
      correlationId,
      errorCode: known ? error.code : "invalid_arguments_or_unreadable_source",
      message: known ? error.message : "The dry run could not be completed.",
      externalActions: false,
    })}\n`
  );
  process.exitCode = 1;
}
