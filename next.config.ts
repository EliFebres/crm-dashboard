import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  logging: {
    browserToTerminal: false,
  },
  devIndicators: false,
};

export default nextConfig;
