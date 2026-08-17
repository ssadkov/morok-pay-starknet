import { createConfig, http, injected } from "wagmi";
import { mainnet, sepolia, base, baseSepolia } from "wagmi/chains";

function alchemyUrl(network: string) {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (!key) return undefined;
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, base, baseSepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(alchemyUrl("eth-mainnet")),
    [sepolia.id]: http(alchemyUrl("eth-sepolia")),
    [base.id]: http(alchemyUrl("base-mainnet")),
    [baseSepolia.id]: http(alchemyUrl("base-sepolia")),
  },
  ssr: true,
});
