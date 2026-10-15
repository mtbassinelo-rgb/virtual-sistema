import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  poweredByHeader: false,
};

export default config;
