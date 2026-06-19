import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test infrastructure — linted by Vitest/Playwright, not ESLint
    "__tests__/**",
    "e2e/**",
    "vitest.config.ts",
    "vitest.setup.ts",
    "playwright.config.ts",
  ]),
]);

export default eslintConfig;
