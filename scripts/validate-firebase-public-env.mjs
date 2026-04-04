import fs from "node:fs";
import path from "node:path";
import { findMissingFirebasePublicEnvKeys, parseEnvText } from "./firebase-public-env.mjs";

const targetPath = process.argv[2] || ".env.local";
const resolvedPath = path.resolve(targetPath);
const fileContents = fs.readFileSync(resolvedPath, "utf8");
const env = parseEnvText(fileContents);
const missingKeys = findMissingFirebasePublicEnvKeys(env);

if (missingKeys.length > 0) {
  console.error(
    `Missing required Firebase public env keys in ${resolvedPath}: ${missingKeys.join(", ")}`
  );
  process.exit(1);
}

console.log(
  `Validated required Firebase public env keys in ${resolvedPath}: ${missingKeys.length} missing`
);
