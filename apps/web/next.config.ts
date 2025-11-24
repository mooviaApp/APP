import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // @ts-expect-error - allowedDevOrigins is valid in this version but missing from types
    allowedDevOrigins: ["192.168.0.214"],
  },
};

export default nextConfig;
