/** Explicit opt-in, Sepolia only. Uses test STRK and saves recovery keys under
 * .secrets before funding. Run after the contract probe:
 * MOROKPAY_ESCROW_LIVE_TEST=1 npx vitest run scripts/escrow-v2-relay.live.test.ts
 * This exercises the real API handler in-process, without HTTP/UI transport.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { RpcProvider, ec, num, hash, CallData } from "starknet";
import { createPrivateTransfers, Open } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";
import { createEscrowV2Keys } from "@/lib/privacy/escrow-refund-client";
import { ephemeralEvmAddress, signEphemeralClaim, signEphemeralOwnership } from "@/lib/privacy/ephemeral-claimer";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import { handleEscrowRequest } from "@/lib/privacy/escrow-server";
import { refundNoteFromCalldata } from "@/lib/privacy/escrow-refund-proof";
import { submitRelayed } from "@/lib/privacy/relay-submission";
import { privacySdkOf } from "@/lib/privacy/network";
import { starknetOf, STRK_ADDRESS } from "@/lib/starknet/constants";

it.skipIf(process.env.MOROKPAY_ESCROW_LIVE_TEST !== "1")("relays an ephemeral EVM recovery into the sender's private balance", async () => {
  const chain = starknetOf("sepolia");
  const sdk = privacySdkOf("sepolia");
  if (!chain.escrowV2SupportsPrivateRefund) throw new Error("Deploy and probe the private-refund revision first");
  const accounts = JSON.parse(readFileSync(".secrets/sepolia-accounts.json", "utf8")).accounts as {
    role: string; address: string; privateKey: string;
  }[];
  const sender = accounts.find(a => a.role === "spare")!;
  const relay = accounts.find(a => a.role === "deployer")!;
  process.env.MOROKPAY_SEPOLIA_RELAYER_ADDRESS = relay.address;
  process.env.MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY = relay.privateKey;
  process.env.MOROKPAY_SEPOLIA_RPC_URL = sdk.privacyRpcUrl;
  process.env.MOROKPAY_SEPOLIA_RELAY_ENABLED = "true";
  const rpc = new RpcProvider({ nodeUrl: sdk.privacyRpcUrl, specVersion: "0.10.3" });
  const keys = await createEscrowV2Keys("sepolia");
  const stateFile = `.secrets/escrow-v2-relay-${Date.now()}.json`;
  const state: Record<string, unknown> = { escrow: chain.escrowV2, ...keys };
  const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  save();
  const transfers = createPrivateTransfers({
    account: { address: sender.address, signer: new Snip12CallSetSigner({
      accountAddress: sender.address, chainId: sdk.starknetChainId,
      sign: async h => ec.starkCurve.sign(num.toHex(h), sender.privateKey),
    }) },
    viewingKeyProvider: { getViewingKey: async () => deriveViewingKey("morok-relay-probe:spare", sender.address) },
    provingProvider: { url: sdk.proverUrl, chainId: sdk.starknetChainId, nodeUrl: sdk.privacyRpcUrl, ohttp: true },
    discoveryProvider: { url: sdk.discoveryUrl }, poolContractAddress: chain.pool,
  });
  const amount = 5n * 10n ** 18n;
  const block = (await rpc.getBlockNumber()) - 10;
  const discovered = await transfers.discoverNotes({ tokens: [BigInt(STRK_ADDRESS)], blockIdentifier: block });
  const notes = discovered.notes.get(BigInt(STRK_ADDRESS)) ?? [];
  if (notes.reduce((sum, n) => sum + n.amount, 0n) < amount) throw new Error("Fund spare's private balance with 5 Sepolia STRK first");
  const prove = async (builder: ReturnType<typeof transfers.build>) => {
    const at = (await rpc.getBlockNumber()) - 10;
    const invocation = await builder.createProofInvocation({ provingBlockId: at });
    const { callAndProof: { call, proof } } = await transfers.executeWithInvocation(invocation, at);
    const calldata = CallData.compile(call.calldata ?? []).map(v => num.toHex(BigInt(v)));
    if (calldata.some(v => BigInt(v) === BigInt(sender.address))) throw new Error("Proof exposes sender; prepare self-channel separately");
    return { call: { ...call, calldata }, proof: proof.data, proofFacts: proof.proofFacts };
  };
  const [fee] = await rpc.callContract({ contractAddress: chain.pool, entrypoint: "get_fee_amount", calldata: [] });
  const publicBalance = async (address: string) => {
    const [lo, hi] = await rpc.callContract({ contractAddress: STRK_ADDRESS, entrypoint: "balance_of", calldata: [address] });
    return BigInt(lo) + (BigInt(hi) << 128n);
  };
  const privateBalance = async () => {
    const current = await transfers.discoverNotes({ tokens: [BigInt(STRK_ADDRESS)], blockIdentifier: await rpc.getBlockNumber() });
    return (current.notes.get(BigInt(STRK_ADDRESS)) ?? []).reduce((sum, n) => sum + n.amount, 0n);
  };
  const publicBefore = await publicBalance(sender.address);
  const deposit = await prove(transfers.build({ autoSetup: true }).with(STRK_ADDRESS, ops => {
    ops.inputs(...notes); ops.withdraw({ recipient: chain.escrowV2, amount });
  }).invoke(() => ({ contractAddress: chain.escrowV2, calldata: ["0x0", keys.commitment, STRK_ADDRESS,
    num.toHex(amount), keys.owner, keys.refundOwner, "0x1", "0x0"] })).surplusTo(sender.address));
  const parked = await submitRelayed({ network: "sepolia", request: deposit,
    credentials: { rpc: sdk.privacyRpcUrl, address: relay.address, privateKey: relay.privateKey }, poolFee: BigInt(fee) });
  state.depositTx = parked.transactionHash; save();
  await rpc.waitForTransaction(parked.transactionHash);
  console.log("relayed deposit", parked.transactionHash);
  const privateBefore = await privateBalance();
  const refund = await prove(transfers.build({ autoSetup: true }).with(STRK_ADDRESS, ops => {
    ops.transfer({ recipient: sender.address, amount: Open });
  }).invoke(({ openNotes }) => ({ contractAddress: chain.escrowV2,
    calldata: ["0x1", num.toHex(openNotes[0].noteId), keys.commitment, "0x0", "0x0", "0x0", "0x0", "0x0", "0x0"] })).surplusTo(sender.address));
  const noteId = refundNoteFromCalldata({ calldata: refund.call.calldata, escrow: chain.escrowV2,
    commitment: keys.commitment, token: STRK_ADDRESS });
  const intent = await signEphemeralClaim({ seed: keys.refundSeed, starknetAddress: keys.refundOwner,
    snChainName: sdk.snChainName, evmChainId: 11155111, caller: relay.address,
    executeBefore: (await rpc.getBlock("latest")).timestamp + 600,
    call: { to: chain.escrowV2, selector: hash.getSelectorFromName("authorize_refund"), calldata: [keys.commitment, noteId] } });
  const response = await handleEscrowRequest(new Request("http://localhost/api/escrow/refund", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network: "sepolia",
      commitment: keys.commitment, evmAddress: ephemeralEvmAddress(keys.refundSeed),
      signature: await signEphemeralOwnership(keys.refundSeed, OWNERSHIP_MESSAGE), calldata: intent.calldata, refundProof: refund }),
  }), "refund");
  const result = await response.json();
  if (!response.ok) throw new Error(`Refund API ${response.status}: ${result.error}`);
  state.refundTx = result.transactionHash; save();
  await rpc.waitForTransaction(result.transactionHash);
  console.log("EVM recovery API refund", result.transactionHash);
  expect(await privateBalance() - privateBefore).toBe(amount);
  expect(await publicBalance(sender.address)).toBe(publicBefore);
  expect(await publicBalance(keys.refundOwner)).toBe(0n);
  const entry = await rpc.callContract({ contractAddress: chain.escrowV2, entrypoint: "get_entry", calldata: [keys.commitment] });
  expect(BigInt(entry[5])).toBe(1n);
}, 600_000);
