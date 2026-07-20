import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next already registers the jsx-a11y plugin; enable the full
  // recommended rule levels on top of the subset next turns on by default.
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Dialogs and the command palette move focus deliberately on open —
      // required dialog focus management, not an autofocus antipattern.
      "jsx-a11y/no-autofocus": "off",
      // Scrollable table wrappers are keyboard-focusable labelled regions
      // (axe: scrollable-region-focusable); allow tabIndex on role="region".
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"], allowExpressionValues: true }],
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
