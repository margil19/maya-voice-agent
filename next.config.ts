import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The old domain stays alive because Retell's tool calls use it, but people
  // visiting it are sent to the current reviewer URL. /api/* is left alone.
  async redirects() {
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "prosper-chi.vercel.app" }],
        destination: "https://maya-voice-agent-demo.vercel.app/:path",
        permanent: false,
      },
    ];
  },
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
