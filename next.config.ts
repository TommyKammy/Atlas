import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Hide the Next.js development indicator (the bottom-left "N" badge).
  // Compile/runtime errors are still surfaced by Next.js.
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  cacheComponents: true,
  partialPrefetching: true,
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
