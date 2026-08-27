import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@neondatabase/serverless"],
};

export default nextConfig;
