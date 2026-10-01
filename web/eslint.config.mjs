import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // These existing report/navigation effects synchronize external state.
  // Keep their React modernization debt visible as warnings; new components
  // retain the default error. Do not expand this list for new violations.
  {
    files: [
      "src/app/org/[[]organizationSlug]/ugc-status/ugc-status-client.tsx",
      "src/components/org-dashboard/ad-profit-auto-refresh.tsx",
      "src/components/org-dashboard/org-sidebar.tsx",
      "src/components/org-dashboard/revenue-profitability-client.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
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
