import type { NextConfig } from "next";
import { APP_VERSION } from "./lib/version";

// PostHog is reverse-proxied through our own origin (/ingest) so ad blockers that
// target posthog.com don't drop writers from the data. The region follows the
// host in NEXT_PUBLIC_POSTHOG_HOST (US by default).
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const posthogAssetsHost = posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com");

const nextConfig: NextConfig = {
  // Freeze the build's version into the client bundle so an open tab knows the
  // number it was served with, to compare against the live /api/version.
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // Required by the PostHog proxy: its endpoints have trailing slashes.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogAssetsHost}/static/:path*` },
      { source: "/ingest/array/:path*", destination: `${posthogAssetsHost}/array/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        // The service worker must never be cached by the browser, so a new shell
        // version is picked up on the next visit rather than pinned indefinitely.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
