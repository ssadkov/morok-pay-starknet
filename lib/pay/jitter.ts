/**
 * A withdrawal amount chosen so it does not match anything anybody knows.
 *
 * Inside the pool an amount is not published, so the exposure is not the
 * donation - it is the public edge. An unshield writes its amount, its
 * destination and its time on chain in the clear, and the person best placed
 * to read something into that is a donor: somebody who knows one of the
 * inputs. Give $5 to a creator, watch exactly $5 leave their account, and you
 * have learned that nobody else gave them anything. Withdrawing everything
 * leaks the same way from the other side - a balance that goes to zero says
 * the total was exactly this.
 *
 * So the jitter takes a slice off the top rather than rounding to something
 * tidy: the amount stops matching any figure an observer already holds, and a
 * remainder stays behind so the balance does not visibly empty. It is not
 * anonymity and does not pretend to be - correlating timing still works, and
 * somebody who watches every withdrawal still sees the sum. It removes the
 * single cheapest inference, which is the one that gets made.
 */

/** USDC has six decimals; the UI works in cents, so a cent is the step. */
const CENT = BigInt(10_000);
const CENTS_PER_DOLLAR = BigInt(100);

/** Below this there is nothing to take a slice off. */
const MIN_JITTERABLE_CENTS = BigInt(20);

function pick(random: () => number, lo: bigint, hi: bigint): bigint {
  if (hi <= lo) return lo;
  const span = Number(hi - lo) + 1;
  const roll = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * span);
  return lo + BigInt(roll);
}

/**
 * Picks an amount between 95% and 99.5% of `maxRaw`, never above it and never
 * a whole dollar.
 *
 * The result is truncated to whole cents because that is the precision the
 * amount field round-trips through, and a value the input cannot represent
 * would be silently altered on its way back.
 */
export function jitterUnshieldAmount(
  maxRaw: bigint,
  random: () => number = Math.random,
): bigint {
  const maxCents = maxRaw / CENT;
  if (maxCents <= BigInt(0)) return BigInt(0);
  /* Too small to slice: taking anything off leaves dust rather than cover, so
     this behaves like Max instead of pretending to hide something. */
  if (maxCents < MIN_JITTERABLE_CENTS) return maxCents * CENT;

  const halfPercent = maxCents / BigInt(200);
  const hi = maxCents - (halfPercent > BigInt(0) ? halfPercent : BigInt(1));
  const lo = (maxCents * BigInt(95)) / BigInt(100);

  let cents = pick(random, lo, hi);
  /* A whole dollar is the one shape this is meant to avoid, and the range is
     wide enough that stepping down from it stays inside. */
  if (cents % CENTS_PER_DOLLAR === BigInt(0)) {
    const stepped = cents - pick(random, BigInt(1), BigInt(99));
    cents = stepped >= lo ? stepped : cents - BigInt(1);
  }
  return cents * CENT;
}
