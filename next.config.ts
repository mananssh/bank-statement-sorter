import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // Statement workbooks can be several MB
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
