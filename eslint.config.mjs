import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["interface", "typeAlias"],
          format: null,
          // Ban step-number positional names like Step1Result, Step2Data, etc.
          custom: {
            regex: "^Step\\d",
            match: false,
          },
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
