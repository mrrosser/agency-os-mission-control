import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
