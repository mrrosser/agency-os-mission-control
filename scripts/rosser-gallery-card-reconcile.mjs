#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { parseRosserGalleryCardSourceForCanonicalImport } from "../lib/crm/rosser-gallery-card-import.ts";
import {
  reconcileRosserGalleryCardImport,
  RosserGalleryCardReconciliationError,
} from "../lib/crm/rosser-gallery-card-reconciler.ts";

function takeValue(values, index, name) {
  const token = values[index];
  if (token.startsWith(`${name}=`)) return { value: token.slice(name.length + 1), consumed: 0 };
  if (token === name && values[index + 1] && !values[index + 1].startsWith("--")) {
    return { value: values[index + 1], consumed: 1 };
  }
  return null;
}

function parseArguments(values) {
  const options = {
    file: null,
    workspace: null,
    receipt: null,
    confirmation: null,
    apply: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--apply") {
      options.apply = true;
      continue;
    }
    let parsed = takeValue(values, index, "--file");
    if (parsed) {
      options.file = parsed.value;
      index += parsed.consumed;
      continue;
    }
    parsed = takeValue(values, index, "--workspace-id");
    if (parsed) {
      options.workspace = parsed.value;
      index += parsed.consumed;
      continue;
    }
    parsed = takeValue(values, index, "--receipt");
    if (parsed) {
      options.receipt = parsed.value;
      index += parsed.consumed;
      continue;
    }
    parsed = takeValue(values, index, "--confirm");
    if (parsed) {
      options.confirmation = parsed.value;
      index += parsed.consumed;
      continue;
    }
    throw new Error("Unsupported argument.");
  }
  if (!options.file || !options.workspace) {
    throw new Error("Provide --file and the explicit --workspace-id binding.");
  }
  if (!options.apply && (options.receipt || options.confirmation)) {
    throw new Error("--receipt and --confirm are apply-only arguments.");
  }
  if (options.apply && (!options.receipt || !options.confirmation)) {
    throw new Error("Apply requires --receipt and --confirm from a fresh dry-run.");
  }
  return options;
}

function structuredLog(event, fields) {
  process.stdout.write(
    `${JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), ...fields })}\n`
  );
}

const correlationId = randomUUID();

try {
  const options = parseArguments(process.argv.slice(2));
  const ownerUid = String(process.env.ROSSER_GALLERY_IMPORT_OWNER_UID || "").trim();
  if (!ownerUid) throw new Error("ROSSER_GALLERY_IMPORT_OWNER_UID is required.");

  const sourceBytes = await readFile(options.file);
  const source = parseRosserGalleryCardSourceForCanonicalImport(sourceBytes);
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) {
    throw new Error("A trusted server project binding is required.");
  }
  const app = getApps()[0] ||
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  if (app.options.projectId !== projectId) {
    throw new Error("The initialized Firebase app does not match the server project binding.");
  }
  const report = await reconcileRosserGalleryCardImport({
    source,
    ownerUid,
    requestedWorkspaceId: options.workspace,
    requestedSourceReceipt: options.receipt || undefined,
    mode: options.apply ? "apply" : "dry_run",
    confirmation: options.confirmation || undefined,
    correlationId,
    db: getFirestore(app),
    log: { info: structuredLog },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, report }, null, 2)}\n`);
} catch (error) {
  const known = error instanceof RosserGalleryCardReconciliationError;
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "crm.rosser_gallery_card_import.failed",
      timestamp: new Date().toISOString(),
      correlationId,
      errorCode: known ? error.code : "invalid_arguments_or_runtime_failure",
      message: known ? error.message : "The canonical import operation could not be completed.",
      writesConfirmed: false,
      externalMessages: 0,
    })}\n`
  );
  process.exitCode = 1;
}
