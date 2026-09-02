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
 * How much STRK an account needs before the pool registration is safe to
 * attempt - the funding floor, not the price.
 *
 * The registration itself has measured 8.68 to 10.72 STRK across four runs on
 * mainnet: a fixed 6 STRK pool fee plus 2.68-4.72 of gas, a 76% swing on the
 * same operation. So 11 is the average bill and a coin flip as a threshold,
 * and the four STRK above it are deliberately bought headroom - the failure
 * they prevent is being told a number was enough and then running out
 * afterwards. See docs/who-pays.md.
 *
 * The screen and the deploy route disagreed about this, 11 against 15, so
 * funding an address by hand with 12 satisfied the screen and was refused by
 * the server. They now share this one, and it is the cautious number rather
 * than the cheap one.
 */
export const ONBOARDING_MIN_STRK = BigInt(15) * BigInt(10) ** BigInt(18);

/** The least a Fast Transfer of `sent` can deliver; its fee is a ceiling. */
export function bridgeDeliversAtLeast(sent: bigint): bigint {
  return sent - cctpFastMaxFee(sent);
}
