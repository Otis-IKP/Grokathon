import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and behind a CAS session, so there is nothing to
  // prerender; Cache Components would only add Suspense plumbing.
  serverExternalPackages: ["@electric-sql/pglite", "unpdf", "postgres"],
  // The end-to-end tests run their own dev server next to `pnpm dev`, in a separate build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Agent prompts (and, for MOCK_EXTERNAL deployments, fixtures) are read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./src/server/agents/prompts/**", "./tests/fixtures/**", "./drizzle/**", "./scripts/data/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
