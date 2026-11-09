import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is bound to every interface, so the browser origin is 127.0.0.1.
  // Next blocks the dev websocket unless that host is named here, and without the
  // websocket the page never becomes interactive.
  allowedDevOrigins: ["127.0.0.1"],
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
