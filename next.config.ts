import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      // e.g. "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

export default nextConfig;
