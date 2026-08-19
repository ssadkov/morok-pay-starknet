import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const REWARDS_USDC = [10, 3, 3, 2, 2, 2, 2, 2, 2, 2];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseDropEntries(text) {
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
      throw new Error(`Line ${index + 1}: Private Drop must use mainnet`);
    }
    if (url.searchParams.get("kind") !== "drop") {
      throw new Error(`Line ${index + 1}: link is not a Private Drop entry`);
    }
    if (!ADDRESS_RE.test(address)) {
      throw new Error(`Line ${index + 1}: invalid Ready address`);
    }
    if (url.searchParams.has("amount")) {
      throw new Error(`Line ${index + 1}: reward amount must be organizer-chosen`);
    }
    if (seen.has(address)) {
      throw new Error(`Line ${index + 1}: duplicate Ready address ${address}`);
    }

    seen.add(address);
    entries.push({ address, url: value });
  }

  if (!entries.length) throw new Error("No eligible Private Drop entries");
  if (entries.length !== REWARDS_USDC.length) {
    throw new Error(
      `Expected exactly ${REWARDS_USDC.length} first eligible entries, got ${entries.length}`,
    );
  }
  return entries;
}

export function allocatePrivateDrop(entries, seed) {
  if (!/^0x[0-9a-fA-F]+$/.test(seed)) {
    throw new Error("Seed must be a Starknet block hash");
  }
  const canonicalAddresses = entries
    .map((entry) => entry.address)
    .sort((a, b) => a.localeCompare(b));
  const listHash = `0x${sha256(canonicalAddresses.join("\n"))}`;
  const ranked = entries
    .map((entry) => ({
      ...entry,
      score: `0x${sha256(`${seed.toLowerCase()}\n${listHash}\n${entry.address}`)}`,
    }))
    .sort((a, b) => a.score.localeCompare(b.score));

  return {
    algorithm:
      "rank by sha256(seed + newline + listHash + newline + address); assign rewards [10,3,3,2,2,2,2,2,2,2]",
    seed: seed.toLowerCase(),
    listHash,
    eligibleCount: entries.length,
    budgetUsdc: REWARDS_USDC.reduce((sum, amount) => sum + amount, 0),
    allocations: ranked.map((entry, index) => ({
      ...entry,
      amountUsdc: REWARDS_USDC[index],
    })),
  };
}

async function main() {
  const [file, seed] = process.argv.slice(2);
  if (!file || !seed) {
    throw new Error(
      "Usage: node scripts/draw-private-drop.mjs <first-10-entries.txt> <finalized-block-hash>",
    );
  }
  const entries = parseDropEntries(await readFile(file, "utf8"));
  const result = allocatePrivateDrop(entries, seed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
