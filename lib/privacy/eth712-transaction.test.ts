import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { EDataAvailabilityMode, type InvocationsSignerDetails } from "starknet";

import {
  eth712TransactionHash,
  eth712TransactionTypedData,
  eth712FundedResourceBounds,
  ETH712_TEST_MAXIMUM_GAS_FEE,
  ethSignatureToAccountFelts,
  safeEth712TransactionError,
} from "./eth712-transaction";

const details: InvocationsSignerDetails = {
  walletAddress: "0x123",
  cairoVersion: "1",
  chainId: "0x534e5f5345504f4c4941",
  version: "0x3",
  nonce: "0x4",
  resourceBounds: {
    l1_gas: { max_amount: BigInt(1), max_price_per_unit: BigInt(2) },
    l2_gas: { max_amount: BigInt(3), max_price_per_unit: BigInt(4) },
    l1_data_gas: { max_amount: BigInt(5), max_price_per_unit: BigInt(6) },
  },
  tip: BigInt(0),
  paymasterData: [],
  accountDeploymentData: [],
  nonceDataAvailabilityMode: EDataAvailabilityMode.L1,
  feeDataAvailabilityMode: EDataAvailabilityMode.L1,
};

describe("Eth712Account transaction signer", () => {
  it("pins the official Transaction and metadata type hashes", () => {
    expect(
      keccak256(
        toBytes(
          "Transaction(Call[] calls,TransactionMetadata metadata)Call(uint256 address,uint256 selector,uint256[] data)TransactionMetadata(uint256 version,uint256 chain_id,uint256[] execution_resources,uint256 tip,uint256 nonce)",
        ),
      ),
    ).toBe(
      "0x1dc45489b8d4418703686ca441c4ea8ead534ff02815a47b9059490edf3a0c68",
    );
    expect(
      keccak256(
        toBytes(
          "TransactionMetadata(uint256 version,uint256 chain_id,uint256[] execution_resources,uint256 tip,uint256 nonce)",
        ),
      ),
    ).toBe(
      "0x3e1a84b9a25a2ffe216927b61cc91a10921dabd3305985281d0bb9707b0d8310",
    );
  });

  it("builds metadata in the exact resource order used on-chain", () => {
    const typedData = eth712TransactionTypedData({
      accountAddress: "0x1234567890abcdef1234567890abcdef1234567890",
      calls: [
        { contractAddress: "0x456", entrypoint: "transfer", calldata: ["0x7"] },
      ],
      details,
      snChainName: "SN_SEPOLIA",
      evmChainId: BigInt(11155111),
    });

    expect(typedData.domain.verifyingContract).toBe(
      "0x00000000abcdef1234567890abcdef1234567890",
    );
    expect(typedData.message.metadata.execution_resources).toEqual([
      BigInt("0x4c315f474153"),
      BigInt(1),
      BigInt(2),
      BigInt("0x4c325f474153"),
      BigInt(3),
      BigInt(4),
      BigInt("0x4c315f44415441"),
      BigInt(5),
      BigInt(6),
    ]);
    expect(eth712TransactionHash(typedData)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("converts a browser signature to the account six-felt format", () => {
    expect(
      ethSignatureToAccountFelts(
        "0x00000000000000000000000000000000112233445566778899aabbccddeeff0000000000000000000000000000000000ffeeddccbbaa998877665544332211001c",
        BigInt(11155111),
      ),
    ).toEqual([
      "0x0",
      "0x112233445566778899aabbccddeeff00",
      "0x0",
      "0xffeeddccbbaa99887766554433221100",
      "0x1c",
      "0xaa36a7",
    ]);
  });

  it("does not expose a rejected transaction signature in UI errors", () => {
    const rawRpcError = new Error(
      'RPC params: {"signature":["0xsecret"]} validation failed: Out of gas',
    );

    const safeMessage = safeEth712TransactionError(rawRpcError);

    expect(safeMessage).toContain("ran out of L2 gas");
    expect(safeMessage).not.toContain("0xsecret");
    expect(safeMessage).not.toContain("signature");
  });

  it("uses a generic sanitized message for unknown RPC failures", () => {
    expect(
      safeEth712TransactionError(
        new Error('RPC params: {"signature":["0xsecret"]} unexpected error'),
      ),
    ).toBe(
      "MetaMask or Starknet rejected the request. Raw RPC transaction details are hidden.",
    );
  });

  it("builds validation resource bounds capped by the public balance", () => {
    const publicBalance = BigInt(14) * BigInt(10) ** BigInt(18);
    const transferAmount = BigInt(10) ** BigInt(16);
    const estimated = {
      l1_gas: { max_amount: BigInt(0), max_price_per_unit: BigInt(1) },
      l2_gas: {
        max_amount: BigInt(1_763_866),
        max_price_per_unit: BigInt(323_236_488_232),
      },
      l1_data_gas: {
        max_amount: BigInt(288),
        max_price_per_unit: BigInt(1_140_198_809_799),
      },
    };

    const provisional = eth712FundedResourceBounds({
      estimated,
      publicBalance,
      transferAmount,
    });
    const maximumFee =
      provisional.l1_gas.max_amount *
        provisional.l1_gas.max_price_per_unit +
      provisional.l2_gas.max_amount *
        provisional.l2_gas.max_price_per_unit +
      provisional.l1_data_gas.max_amount *
        provisional.l1_data_gas.max_price_per_unit;

    expect(provisional.l2_gas.max_amount).toBeGreaterThan(
      estimated.l2_gas.max_amount,
    );
    expect(maximumFee + transferAmount).toBeLessThanOrEqual(publicBalance);
  });

  it("does not scale the gas cap with a large funded balance", () => {
    const estimated = {
      l1_gas: { max_amount: 0n, max_price_per_unit: 1n },
      l2_gas: {
        max_amount: 1_763_866n,
        max_price_per_unit: 323_236_488_232n,
      },
      l1_data_gas: {
        max_amount: 288n,
        max_price_per_unit: 1_140_198_809_799n,
      },
    };
    const bounded = eth712FundedResourceBounds({
      estimated,
      publicBalance: 107n * 10n ** 18n,
      transferAmount: 2n * 10n ** 18n,
      maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
    });
    const maximumFee =
      bounded.l1_gas.max_amount * bounded.l1_gas.max_price_per_unit +
      bounded.l2_gas.max_amount * bounded.l2_gas.max_price_per_unit +
      bounded.l1_data_gas.max_amount *
        bounded.l1_data_gas.max_price_per_unit;

    expect(maximumFee).toBeLessThanOrEqual(ETH712_TEST_MAXIMUM_GAS_FEE);
    expect(maximumFee).toBeGreaterThan(0n);
  });

  it("classifies nested RPC causes without exposing them", () => {
    const safeMessage = safeEth712TransactionError({
      message: "Transaction execution error",
      cause: { data: { reason: "Out of gas" } },
    });

    expect(safeMessage).toContain("ran out of L2 gas");
    expect(safeMessage).not.toContain("reason");
  });
});
