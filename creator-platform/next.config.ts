import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The full tsconfig intentionally includes operational integration tests
  // that import the laptop worker outside the isolated Vercel root. Verify
  // those before deployment; production type-checks only shipped web code.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;
