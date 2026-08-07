import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/agents/control-plane": [
      "./please-review/from-root/config-templates/knowledge-pack.v2.json",
    ],
  },
  serverExternalPackages: [
    "@google-cloud/tasks",
    "@google-cloud/secret-manager",
  ],
  images: {
    unoptimized: true,
  },
  eslint: {
    // Firebase Hosting builds run `next build` and will fail hard on ESLint issues.
    // We keep `npm run lint` available for local/CI use, but don't block builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
