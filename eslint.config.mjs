import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
  {
    rules: {
      // Too strict for localStorage hydration, matchMedia, and carousel init; safe to relax here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
];

export default config;
