import type { AppNetwork } from "@/lib/network";
import { NOTE_MATURITY_MS } from "@/lib/pay/maturity";
import { extractTxHash } from "@/lib/starknet/errors";
import { transferPrivate } from "@/lib/starknet/actions";
import type { ShieldToken } from "@/lib/starknet/tokens";

/** Tiny private self-transfer that opens the Append channel without spending the park amount. */
export const ESCROW_SELF_CHANNEL_DUST = 1n;

type ChannelAccount = Parameters<typeof transferPrivate>[0] & {
  discoverChannels?: () => Promise<{ recipient: string; noteCount: number }[]>;
};

export function sameFeltAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** `null` when the wallet cannot enumerate channels — caller should try park and recover. */
export async function hasPrivateSelfChannel(
  account: ChannelAccount,
  address: string,
): Promise<boolean | null> {
  if (typeof account.discoverChannels !== "function") return null;
  const channels = await account.discoverChannels();
  return channels.some((channel) => sameFeltAddress(channel.recipient, address));
}

/**
 * Open a private self-channel when missing, via a relayed dust transfer to self.
 * Must not be bundled into depositToEscrowV2 — that proof refuses naming the sender.
 */
export async function ensureEscrowSelfChannel(args: {
  account: ChannelAccount;
  token: ShieldToken;
  senderAddress: string;
  network: AppNetwork;
  /** Force the dust transfer even if discovery is unavailable or stale. */
  force?: boolean;
}): Promise<{ opened: boolean; txHash?: string }> {
  if (!args.force) {
    const known = await hasPrivateSelfChannel(args.account, args.senderAddress);
    if (known === true) return { opened: false };
    if (known === null) return { opened: false };
  }
  const response = await transferPrivate(
    args.account,
    args.token,
    ESCROW_SELF_CHANNEL_DUST,
    args.senderAddress,
    { network: args.network },
  );
  return { opened: true, txHash: extractTxHash(response) };
}

export { NOTE_MATURITY_MS };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
