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
 * Enough to carry on with: the swap, plus change for its rounding. This is
 * what every gate checks - not what the user was asked to send.
 */
export const ONBOARDING_MIN_USDC = ONBOARDING_SWAP_USDC + BigInt(50_000);

/**
 * What the screen suggests bringing over. Larger than the requirement on
 * purpose: activation now, and a withdrawal later, both cost money.
 */
export const ONBOARDING_SUGGESTED_USDC = BigInt(2_000_000);

/** The least a Fast Transfer of `sent` can deliver; its fee is a ceiling. */
export function bridgeDeliversAtLeast(sent: bigint): bigint {
  return sent - cctpFastMaxFee(sent);
}
