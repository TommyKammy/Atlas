import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // Hide the Next.js development indicator (the bottom-left "N" badge).
  // Compile/runtime errors are still surfaced by Next.js.
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // macOS Docker bind mounts may not forward file-system change events.
  ...(process.env.NODE_ENV === "development" && process.env.ATLAS_DEV_POLLING === "1"
    ? { watchOptions: { pollIntervalMs: 1000 } }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // The Proxy excludes these authenticated JSON routes to keep uploads streaming.
    const headers = Object.entries({
      ...STATIC_SECURITY_HEADERS,
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    }).map(([key, value]) => ({ key, value }));
    return ["/api/attachments", "/api/projects/:id/import"].map((source) => ({ source, headers }));
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
