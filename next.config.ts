import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Native module (better-sqlite3) and pdfjs (its fake-worker module can't be
  // bundled) load from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
  experimental: {
    serverActions: {
      // Statement workbooks can be several MB
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
