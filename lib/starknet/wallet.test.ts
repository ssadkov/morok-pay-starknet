import { describe, expect, it } from "vitest";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

import { listReadyWallets } from "./wallet";

function wallet(name: string) {
  return { name } as WalletWithStarknetFeatures;
}

describe("listReadyWallets", () => {
  it("hides Braavos and MetaMask, and prefers Ready", () => {
    const listed = listReadyWallets([
      wallet("Braavos"),
      wallet("Xverse"),
      wallet("MetaMask"),
      wallet("Ready Wallet"),
    ]);
    expect(listed.map((entry) => entry.name)).toEqual([
      "Ready Wallet",
      "Xverse",
    ]);
  });
});
