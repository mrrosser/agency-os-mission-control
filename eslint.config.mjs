import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-config-next is still "extends"-based; adapt it for ESLint flat config.
const compat = new FlatCompat({ baseDirectory: __dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Keep build artifacts out of lint scope (and preserve Next's defaults).
  globalIgnores([
    ".next/**",
    ".firebase/**",
    ".tmp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Staging/archival area; not part of the active app.
    "please-review/**",
  ]),
  // Current codebase uses `any` in a few boundary layers (external APIs, generic JSON).
  // Keep lint actionable: warn instead of failing the whole run.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
