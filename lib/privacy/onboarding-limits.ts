import { cctpFastMaxFee } from "@/lib/cctp/constants";

/**
 * The USDC thresholds the way in is judged against, in one place.
 *
 * These were three separate literals - one in the onboarding screen, one in
 * its settle loop, one in the deploy route - and all three read "two dollars",
 * because two dollars is the number a person is told to bring. But CCTP Fast
 * Transfer takes its fee in flight, so sending two delivers 1.99, and every
 * gate written against the amount that was *sent* rejects the money that
 * actually arrived. The screen waited for a transfer it could already see,
 * and the deploy route then refused the account by a cent.
 *
 * So the suggestion and the requirement are separate constants now, and
 * `onboarding-limits.test.ts` asserts the relationship between them that has
 * to hold: what the suggested amount survives the bridge as must still clear
 * the requirement.
 */

/** What the swap sells to buy the activation STRK. */
export const ONBOARDING_SWAP_USDC = BigInt(1_000_000);

/**
 * The ceiling the paymaster may charge for relaying that swap.
 *
 * It bills in the same USDC the swap is spending, so the two are drawn from
 * one balance and have to fit in it together. A ceiling is not a price - the
 * actual gas is a fraction of this - but the paymaster has to see the account
 * cover the ceiling before it will agree to relay at all.
 */
export const ONBOARDING_SWAP_GAS_USDC = BigInt(350_000);

/**
 * Enough to carry on with: the swap and the gas that submits it. This is what
 * every gate checks - not what the user was asked to send.
 */
export const ONBOARDING_MIN_USDC =
  ONBOARDING_SWAP_USDC + ONBOARDING_SWAP_GAS_USDC;

/**
 * What the screen suggests bringing over. Larger than the requirement on
 * purpose: activation now, and a withdrawal later, both cost money.
 */
export const ONBOARDING_SUGGESTED_USDC = BigInt(2_000_000);

/**
 * How much public STRK an EVM account needs before any self-paid pool action
 * is safe to attempt - registration, shield, or unshield - the funding floor,
 * not the price of any one of them.
 *
 * All three have been measured on mainnet in the same neighborhood: a fixed
 * 6 STRK pool fee plus gas that has ranged 2.68-5.31 across the runs so far
 * (registration 8.68-10.72 total, shield 1 USDC 11.31, unshield 1 USDC
 * 10.41) - a swing of over 75% on the same class of operation. So the average
 * bill is around 10-11 and a coin flip as a threshold, and the STRK above it
 * is deliberately bought headroom. The failure being paid for is a specific
 * one: telling somebody a number was enough, taking their money, and having
 * them run out partway through with nothing to show for the gas already
 * spent. See docs/who-pays.md.
 *
 * The screen and the deploy route once disagreed about this for registration
 * specifically, 11 against 15, so funding an address by hand with 12
 * satisfied the screen and was refused by the server. Shield had the same gap
 * in the other direction - no check at all - which let a USDC shield reach
 * the wallet and fail on-chain instead of being refused up front with a
 * reason. Registration, shield, and unshield now all read this one.
 */
export const ONBOARDING_MIN_STRK = BigInt(15) * BigInt(10) ** BigInt(18);

/** The least a Fast Transfer of `sent` can deliver; its fee is a ceiling. */
export function bridgeDeliversAtLeast(sent: bigint): bigint {
  return sent - cctpFastMaxFee(sent);
}
