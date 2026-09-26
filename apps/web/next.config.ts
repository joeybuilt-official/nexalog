import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Dockerfile can ship /.next/standalone (Phase 1 deploy, D3).
  output: "standalone",
  // Server-only packages bundled outside the standalone trace (drizzle, sharp).
  serverExternalPackages: ["sharp", "drizzle-orm", "postgres"],
};

export default nextConfig;
