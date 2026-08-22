import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["features/**/client/**", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/*", "**/*.server", "**/*.server.*"],
              message: "Client code must not import server modules.",
            },
            {
              group: ["cloudflare:workers"],
              message: "Client code must not import Cloudflare Worker modules.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/server/]",
          message: "Client code must not dynamically import server modules.",
        },
        {
          selector: "ImportExpression[source.value=/cloudflare:workers/]",
          message: "Client code must not dynamically import Cloudflare Worker modules.",
        },
      ],
    },
  },
  {
    files: ["features/**/shared/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/client/**", "**/*.client", "**/*.client.*"],
              message: "Shared code must not import client modules.",
            },
            {
              group: ["**/server/**", "**/*.server", "**/*.server.*"],
              message: "Shared code must not import server modules.",
            },
            {
              group: ["cloudflare:workers"],
              message: "Shared code must not import Cloudflare Worker modules.",
            },
            {
              group: ["react", "react/*"],
              message: "Shared code must not import React.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/server/]",
          message: "Shared code must not dynamically import server modules.",
        },
        {
          selector: "ImportExpression[source.value=/client/]",
          message: "Shared code must not dynamically import client modules.",
        },
        {
          selector: "ImportExpression[source.value=/cloudflare:workers/]",
          message: "Shared code must not dynamically import Cloudflare Worker modules.",
        },
      ],
    },
  },
]);

export default eslintConfig;
