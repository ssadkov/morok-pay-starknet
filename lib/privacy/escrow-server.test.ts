import { beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "starknet";
import { privateKeyToAccount } from "viem/accounts";

const mocks = vi.hoisted(() => ({ call: vi.fn(), execute: vi.fn(), estimate: vi.fn(), inspect: vi.fn() }));
vi.mock("starknet", async (original) => {
  const actual = await original<typeof import("starknet")>();
  return { ...actual,
    RpcProvider: class { callContract = mocks.call; getBlock = async () => ({ timestamp: 1800000000 }); },
    Account: class {
      address = "0x333";
      getNonce = async () => "0x1";
      execute = mocks.execute;
      estimateInvokeFee = mocks.estimate;
    },
  };
});
vi.mock("./eth712-account", async (original) => ({
  ...await original<typeof import("./eth712-account")>(), inspectEth712Account: mocks.inspect,
}));
vi.mock("@/lib/starknet/constants", async (original) => {
  const actual = await original<typeof import("@/lib/starknet/constants")>();
  return { ...actual, starknetOf: (network: "sepolia" | "mainnet") => ({
    ...actual.starknetOf(network), escrowV2: "0x123", escrowV2SupportsPrivateRefund: true,
  }), isSupportedPrivateRefundEscrow: (_network: string, address: string) =>
    BigInt(address) === 0x123n || BigInt(address) === 0x789n };
});

import { handleEscrowRequest } from "./escrow-server";
import { OWNERSHIP_MESSAGE, STRK20_ETH712_ACCOUNT_CLASS_HASH } from "./eth712-account";
import { signEphemeralClaim } from "./ephemeral-claimer";
import { starknetOf } from "@/lib/starknet/constants";

const seed = `0x${"11".repeat(32)}` as const;
const signer = privateKeyToAccount(seed);
const token = starknetOf("sepolia").usdc;
let entry: string[];
let caller = 0;
const bounds = {
  l1_gas: { max_amount: 1n, max_price_per_unit: 1n },
  l1_data_gas: { max_amount: 1n, max_price_per_unit: 1n },
  l2_gas: { max_amount: 1n, max_price_per_unit: 1n },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOROKPAY_SEPOLIA_RELAY_ENABLED", "true");
  vi.stubEnv("MOROKPAY_MAINNET_RELAY_ENABLED", "true");
  vi.stubEnv("MOROKPAY_SEPOLIA_RELAYER_ADDRESS", "0x333");
  vi.stubEnv("MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY", "0x1");
  entry = [token, "0xf4240", "0x222", "0x444", "0x0", "0x0"];
  mocks.call.mockImplementation(async ({ entrypoint }: { entrypoint: string }) => {
    if (entrypoint === "get_entry") return entry;
    if (entrypoint === "get_fee_amount") return [`0x${(2n * 10n ** 18n).toString(16)}`];
    if (entrypoint === "balance_of") return [`0x${(100n * 10n ** 18n).toString(16)}`, "0x0"];
    throw new Error(`Unexpected RPC ${entrypoint}`);
  });
  mocks.inspect.mockResolvedValue({
    starknetAddress: "0x222", factoryAddress: "0x555", deployed: true,
    configuredAccountClassHash: STRK20_ETH712_ACCOUNT_CLASS_HASH,
    deployedClassHash: STRK20_ETH712_ACCOUNT_CLASS_HASH,
  });
  mocks.estimate.mockResolvedValue({ resourceBounds: bounds });
  mocks.execute.mockResolvedValue({ transaction_hash: "0x999" });
});
async function body(entrypoint = "claim", escrow = "0x123") {
  const intent = await signEphemeralClaim({
    seed, starknetAddress: "0x222", snChainName: "SN_SEPOLIA", evmChainId: 11155111,
    caller: "0x333", executeBefore: 1800000300,
    call: { to: escrow, selector: hash.getSelectorFromName(entrypoint), calldata: ["0x456", "0x987"] },
  });
  return { network: "sepolia", commitment: "0x456", evmAddress: signer.address,
    signature: await signer.signMessage({ message: OWNERSHIP_MESSAGE }), calldata: intent.calldata };
}
function request(body: unknown) {
  return new Request("https://local.test/api/escrow/claim", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `test-${++caller}` },
    body: JSON.stringify(body),
  });
}

describe("escrow API never pays for unrelated work", () => {
  it("submits an authorized claim with explicit gas bounds", async () => {
    const response = await handleEscrowRequest(request(await body()), "claim");
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledOnce();
    const [calls, details] = mocks.execute.mock.calls[0];
    expect(calls).toHaveLength(1);
    expect(calls[0].entrypoint).toBe("execute_from_outside_v2");
    const total = Object.values(details.resourceBounds as typeof bounds)
      .reduce((sum, bound) => sum + bound.max_amount * bound.max_price_per_unit, 0n);
    expect(total).toBeLessThanOrEqual(12n * 10n ** 18n);
  });
  it("rejects an unrelated signer using a victim's existing escrow", async () => {
    entry[2] = "0x999";
    const response = await handleEscrowRequest(request(await body()), "claim");
    expect(response.status).toBe(400);
    expect(mocks.estimate).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects an owner's valid signature for an unrelated call", async () => {
    const response = await handleEscrowRequest(request(await body("balance_of")), "claim");
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["mainnet", "sepolia"])("honors the %s kill switch before any RPC", async (network) => {
    vi.stubEnv(network === "mainnet" ? "MOROKPAY_MAINNET_RELAY_ENABLED" : "MOROKPAY_SEPOLIA_RELAY_ENABLED", "false");
    const response = await handleEscrowRequest(request({ ...await body(), network }), "claim");
    expect(response.status).toBe(503);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["unknown-token", "dust", "claimed", "bad-abi"])("rejects %s entries", async (scenario) => {
    if (scenario === "unknown-token") entry[0] = "0xdead";
    if (scenario === "dust") entry[1] = "0x1";
    if (scenario === "claimed") entry[5] = "0x1";
    if (scenario === "bad-abi") entry.pop();
    expect((await handleEscrowRequest(request(await body()), "claim")).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("still sponsors a claim after the refund window opens", async () => {
    entry[4] = "0x1";
    expect((await handleEscrowRequest(request(await body()), "claim")).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("does not sponsor an account running unrecognized code", async () => {
    mocks.inspect.mockResolvedValue({ starknetAddress: "0x222", deployed: true, deployedClassHash: "0xbad" });
    expect((await handleEscrowRequest(request(await body()), "claim")).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed input even without Content-Length", async () => {
    expect((await handleEscrowRequest(request({ garbage: "x".repeat(20001) }), "claim")).status).toBe(413);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("does not submit if the estimated cost exceeds the cap", async () => {
    mocks.estimate.mockResolvedValue({ resourceBounds: { ...bounds,
      l1_gas: { max_amount: 13n * 10n ** 18n, max_price_per_unit: 1n } } });
    expect((await handleEscrowRequest(request(await body()), "claim")).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("atomically deploys recovery account, authorizes the note, and returns through the pool", async () => {
    entry[3] = "0x222"; entry[4] = "0x1";
    mocks.inspect.mockResolvedValue({ starknetAddress: "0x222", factoryAddress: "0x555", deployed: false,
      configuredAccountClassHash: STRK20_ETH712_ACCOUNT_CLASS_HASH });
    const input = { ...await body("authorize_refund"), refundProof: {
      call: { contractAddress: starknetOf("sepolia").pool, entrypoint: "apply_actions",
        calldata: ["0x2", "0x7", "0x11", "0x22", "0x33", token, "0x987",
          "0xa", "0x123", "0x9", "0x1", "0x987", "0x456", "0x0", "0x0", "0x0", "0x0", "0x0", "0x0", "0x1"] },
      proof: "test-proof", proofFacts: ["0x50524f4f4631", "0x1"],
    } };
    const response = await handleEscrowRequest(request(input), "refund");
    expect(response.status).toBe(200);
    const [calls, details] = mocks.execute.mock.calls[0];
    expect(calls.map((call: { entrypoint: string }) => call.entrypoint)).toEqual([
      "deploy_account", "execute_from_outside_v2", "approve", "apply_actions",
    ]);
    expect(details.proof).toBe("test-proof");
  });

  it("accepts an allowlisted historical escrow only for refunds", async () => {
    /* A revision the recovery file remembers but the app no longer points at:
       the allowlist exists so a redeploy cannot strand entries parked in the
       previous contract. 0x789 rather than 0x456, which is already the
       commitment - an address doubling as one hides the mix-up this guards. */
    const historical = "0x789";
    entry[3] = "0x222"; entry[4] = "0x1";
    const input = { ...await body("authorize_refund", historical), escrow: historical, refundProof: {
      call: { contractAddress: starknetOf("sepolia").pool, entrypoint: "apply_actions",
        calldata: ["0x2", "0x7", "0x11", "0x22", "0x33", token, "0x987",
          "0xa", historical, "0x9", "0x1", "0x987", "0x456", "0x0", "0x0", "0x0", "0x0", "0x0", "0x0", "0x1"] },
      proof: "test-proof", proofFacts: ["0x50524f4f4631", "0x1"],
    } };
    expect((await handleEscrowRequest(request(input), "refund")).status).toBe(200);
    expect((await handleEscrowRequest(request({ ...await body(), escrow: historical }), "claim")).status).toBe(409);
  });
});
