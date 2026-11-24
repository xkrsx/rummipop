import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev assets and the HMR WebSocket are cross-site when opened through a tunnel.
  allowedDevOrigins: ["*.trycloudflare.com", "trycloudflare.com", "127.0.0.1"],
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
