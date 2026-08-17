import type { NextConfig } from "next";

function proxy(source: string, target: string | undefined) {
  if (!target) return [];
  const destination = target.replace(/\/$/, "");
  return [
    {
      source,
      destination,
    },
    {
      source: `${source}/:path*`,
      destination: `${destination}/:path*`,
    },
  ];
}

const nextConfig: NextConfig = {
  transpilePackages: ["@starkware-libs/starknet-privacy-sdk"],
  async rewrites() {
    return [
      ...proxy("/privacy/prover", process.env.STRK20_PROVING_URL),
      ...proxy("/privacy/indexer", process.env.STRK20_INDEXER_URL),
    ];
  },
};

export default nextConfig;
