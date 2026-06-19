import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for multi-stage Docker builds — produces a self-contained server.js
  // that does NOT need node_modules in the runner stage (~60% smaller image)
  output: "standalone",

  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
