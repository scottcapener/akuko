import type { NextConfig } from "next";
import { APP_VERSION } from "./lib/version";

const nextConfig: NextConfig = {
  // Freeze the build's version into the client bundle so an open tab knows the
  // number it was served with, to compare against the live /api/version.
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
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
