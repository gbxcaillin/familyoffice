import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/large server-only packages that must not be bundled by Next; they
  // are loaded from node_modules at runtime instead.
  serverExternalPackages: [
    "better-sqlite3",
    "pdf-parse",
    "@anthropic-ai/claude-agent-sdk",
  ],
  // The standalone runtime image only contains files Next traced. The Agent SDK
  // spawns a native `claude` binary shipped as a platform-specific sibling
  // package, which tracing doesn't discover on its own — pull the whole SDK and
  // its platform packages into the trace for the Ask route.
  outputFileTracingIncludes: {
    "/api/agent/ask": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/**",
      "./node_modules/@anthropic-ai/claude-agent-sdk-*/**",
    ],
  },
};

export default nextConfig;
