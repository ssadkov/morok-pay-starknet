/**
 * Splits a fixed USDC budget among however many people actually finish the
 * donation-QR flow, instead of committing to an exact headcount in advance.
 *
 * The predecessor of this script (allocate-first-10.mjs) required exactly
 * ten entries and paid a fixed table of rewards. That only works if you can
 * predict turnout - and the onboarding this contest exercises (install
 * Ready X, fund it, deploy, enable Private) has real, measured friction that
 * makes turnout genuinely uncertain. So instead of guessing a headcount:
 *
 *   - `CAP` is the most entries the contest accepts (7 by default).
 *   - `BASE_WEIGHTS` gives each rank a share of the budget, most for first.
 *   - However many entries actually show up (K <= CAP), the first K weights
 *     are rescaled to sum to exactly the full budget - fewer finishers means
 *     each one gets more, not that the difference goes unspent.
 *
 * The budget is always paid out in full, split by rank. Nobody who finishes
 * is short-changed by a turnout guess made before anyone tried.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

/** Cents of a $20 budget, first place to last. Edit both together. */
export const BUDGET_USDC = 20;
export const CAP = 7;
export const BASE_WEIGHTS = [6, 4, 3, 3, 2, 1, 1];

if (BASE_WEIGHTS.length !== CAP) {
  throw new Error("BASE_WEIGHTS must have exactly CAP entries");
}
if (BASE_WEIGHTS.reduce((sum, w) => sum + w, 0) !== BUDGET_USDC) {
  throw new Error("BASE_WEIGHTS must sum to BUDGET_USDC when every place is filled");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Byte order, not locale order. Both the entry list and the ranking are
 * hashed or ordered by these strings, so a comparison that depends on the
 * machine's locale would let two people compute two different winners from
 * the same seed.
 */
function byteOrder(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseDonationEntries(text) {
  const entries = [];
  const seen = new Set();

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const value = raw.trim();
    if (!value || value.startsWith("#")) continue;

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Line ${index + 1}: expected an absolute MorokPay URL`);
    }

    const address = (url.searchParams.get("to") ?? "").toLowerCase();
    if (url.pathname !== "/pay") {
      throw new Error(`Line ${index + 1}: expected a /pay link`);
    }
    if (url.searchParams.get("n") !== "mainnet") {
      throw new Error(`Line ${index + 1}: Donation QR must use mainnet`);
    }
    if (url.searchParams.get("kind") !== "donation") {
      throw new Error(`Line ${index + 1}: link is not a Donation QR`);
    }
    if (!ADDRESS_RE.test(address)) {
      throw new Error(`Line ${index + 1}: invalid Ready address`);
    }
    if (url.searchParams.has("amount")) {
      throw new Error(`Line ${index + 1}: Donation QR must have an open amount`);
    }
    if (seen.has(address)) {
      throw new Error(`Line ${index + 1}: duplicate Ready address ${address}`);
    }

    seen.add(address);
    entries.push({ address, url: value });
  }

  if (!entries.length) throw new Error("No eligible Donation QR entries");
  if (entries.length > CAP) {
    throw new Error(
      `${entries.length} entries, but the contest caps at ${CAP}. Trim the list to the first ${CAP} eligible entries before allocating.`,
    );
  }
  return entries;
}

/**
 * Rescales the first `count` base weights to sum to exactly `budgetUsdc`,
 * in integer cents, using the largest-remainder method so the total is
 * always exact - no cent lost or invented to rounding.
 */
export function rescaleWeights(count, budgetUsdc = BUDGET_USDC, baseWeights = BASE_WEIGHTS) {
  if (count < 1 || count > baseWeights.length) {
    throw new Error(`count must be between 1 and ${baseWeights.length}`);
  }
  const weights = baseWeights.slice(0, count);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const budgetCents = Math.round(budgetUsdc * 100);

  const raw = weights.map((w) => (w / weightSum) * budgetCents);
  const floors = raw.map(Math.floor);
  let remainder = budgetCents - floors.reduce((sum, c) => sum + c, 0);

  const order = raw
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) {
    floors[order[i].index] += 1;
  }
  remainder = 0;

  return floors.map((cents) => cents / 100);
}

export function allocateContest(entries, seed, options = {}) {
  const budgetUsdc = options.budgetUsdc ?? BUDGET_USDC;
  const baseWeights = options.baseWeights ?? BASE_WEIGHTS;
  if (!/^0x[0-9a-fA-F]+$/.test(seed)) {
    throw new Error("Seed must be a Starknet block hash");
  }
  if (entries.length > baseWeights.length) {
    throw new Error(`${entries.length} entries exceeds the cap of ${baseWeights.length}`);
  }

  const canonicalAddresses = entries
    .map((entry) => entry.address)
    .sort(byteOrder);
  const listHash = `0x${sha256(canonicalAddresses.join("\n"))}`;
  const ranked = entries
    .map((entry) => ({
      ...entry,
      score: `0x${sha256(`${seed.toLowerCase()}\n${listHash}\n${entry.address}`)}`,
    }))
    .sort((a, b) => byteOrder(a.score, b.score));

  const amounts = rescaleWeights(ranked.length, budgetUsdc, baseWeights);

  return {
    algorithm:
      "rank by sha256(seed + newline + listHash + newline + address); " +
      `take the first N of [${baseWeights.join(",")}] and rescale to sum to $${budgetUsdc} (largest-remainder rounding)`,
    seed: seed.toLowerCase(),
    listHash,
    cap: baseWeights.length,
    finisherCount: ranked.length,
    budgetUsdc,
    allocations: ranked.map((entry, index) => ({
      ...entry,
      amountUsdc: amounts[index],
    })),
    /**
     * The half that is safe to post.
     *
     * Publishing an address-to-prize table would take four links their owners
     * already made public and add to them who won what - information the
     * organizer creates rather than reports. The rank scores prove the
     * ordering just as well: anyone can recompute their own from the seed,
     * the list hash and their own address, find it in this list, and see the
     * prize beside it. Nobody learns anybody else's.
     */
    publishable: {
      algorithm:
        "rank by sha256(seed + newline + listHash + newline + address); " +
        `take the first N of [${baseWeights.join(",")}] and rescale to sum to $${budgetUsdc} (largest-remainder rounding)`,
      seed: seed.toLowerCase(),
      listHash,
      finisherCount: ranked.length,
      budgetUsdc,
      ranks: ranked.map((entry, index) => ({
        score: entry.score,
        amountUsdc: amounts[index],
      })),
    },
  };
}

async function main() {
  const [file, seed] = process.argv.slice(2);
  if (!file || !seed) {
    throw new Error(
      "Usage: node scripts/allocate-contest.mjs <entries.txt> <finalized-block-hash>",
    );
  }
  const entries = parseDonationEntries(await readFile(file, "utf8"));
  const result = allocateContest(entries, seed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
