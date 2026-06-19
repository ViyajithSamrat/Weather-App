import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for multi-stage Docker builds — produces self-contained server.js
  output: "standalone",
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
