import { describe, expect, it } from "vitest";
import type { Note } from "@starkware-libs/starknet-privacy-sdk";

import { STRK_ADDRESS } from "@/lib/starknet/constants";
import {
  OPEN_NOTE,
  poolApprovals,
  selectSpendNotes,
  spendPlan,
  type Strk20Action,
} from "./evm-strk20-account";

const USDC = "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343";
const ESCROW = "0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const ANYONE = "0x9294eb7876e92e73f73977d844843654fca6fe85c746d56a90fa8f1d2f5c1a";

const note = (amount: bigint) => ({ amount }) as Note;

/** An approval's u256 low limb - starknet.js types calldata too loosely to index. */
const approvedLow = (call: { calldata?: unknown }) =>
  (call.calldata as string[])[1];

describe("spendPlan", () => {
  it("counts withdrawals and transfers as spending", () => {
    expect(
      spendPlan([
        { type: "withdraw", token: STRK_ADDRESS, amount: "100", recipient: ESCROW },
        { type: "transfer", token: STRK_ADDRESS, amount: "25", recipient: ANYONE },
      ]),
    ).toMatchObject({ spend: BigInt(125), deposited: BigInt(0), needed: BigInt(125) });
  });

  it("does not count an open note as spending - the helper fills its amount", () => {
    expect(
      spendPlan([
        { type: "transfer", token: STRK_ADDRESS, amount: OPEN_NOTE, recipient: ANYONE },
      ]),
    ).toMatchObject({ spend: BigInt(0), needed: BigInt(0) });
  });

  it("lets a deposit in the same set fund the withdrawal beside it", () => {
    /* Shield-and-park: the parked amount arrives from the public balance, so
       nothing extra has to come out of existing notes. */
    expect(
      spendPlan([
        { type: "deposit", token: STRK_ADDRESS, amount: "50" },
        { type: "withdraw", token: STRK_ADDRESS, amount: "50", recipient: ESCROW },
      ]),
    ).toMatchObject({ spend: BigInt(50), deposited: BigInt(50), needed: BigInt(0) });
  });

  it("asks existing notes for the excess only", () => {
    expect(
      spendPlan([
        { type: "deposit", token: STRK_ADDRESS, amount: "20" },
        { type: "withdraw", token: STRK_ADDRESS, amount: "50", recipient: ESCROW },
      ]),
    ).toMatchObject({ needed: BigInt(30) });
  });
});

describe("selectSpendNotes", () => {
  it("takes the smallest notes first, so small ones consolidate", () => {
    const { selected, total, covered } = selectSpendNotes(
      [note(BigInt(100)), note(BigInt(1)), note(BigInt(10))],
      BigInt(11),
    );
    expect(selected.map((item) => item.amount)).toEqual([BigInt(1), BigInt(10)]);
    expect(total).toBe(BigInt(11));
    expect(covered).toBe(true);
  });

  it("still spends one note when the deposits cover everything", () => {
    /* A set that nullifies nothing can be replayed, and the pool answers
       NO_REPLAY_PROTECTION - measured on Sepolia. */
    const { selected, covered } = selectSpendNotes([note(BigInt(7))], BigInt(0));
    expect(selected).toHaveLength(1);
    expect(covered).toBe(true);
  });

  it("is not covered when the account holds no note at all", () => {
    expect(selectSpendNotes([], BigInt(0))).toMatchObject({
      selected: [],
      covered: false,
    });
  });

  it("is not covered when the notes fall short", () => {
    expect(selectSpendNotes([note(BigInt(5))], BigInt(9))).toMatchObject({
      total: BigInt(5),
      covered: false,
    });
  });
});

describe("poolApprovals", () => {
  const fee = BigInt(6);

  it("approves the fee alone when nothing is deposited", () => {
    const approvals = poolApprovals({
      actions: [
        { type: "withdraw", token: USDC, amount: "50", recipient: ESCROW },
      ],
      poolFee: fee,
      poolAddress: POOL,
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0].contractAddress).toBe(STRK_ADDRESS);
    expect(approvedLow(approvals[0])).toBe("6");
  });

  it("folds a STRK deposit into the fee approval rather than adding a second", () => {
    /* The constant is written short and an action's token arrives padded, so
       this only merges if both go through the same normaliser. */
    const approvals = poolApprovals({
      actions: [{ type: "deposit", token: STRK_ADDRESS, amount: "50" }],
      poolFee: fee,
      poolAddress: POOL,
    });
    expect(approvals).toHaveLength(1);
    expect(approvedLow(approvals[0])).toBe("56");
  });

  it("merges a padded STRK address with the short constant", () => {
    const padded = `0x0${STRK_ADDRESS.slice(2)}`;
    const approvals = poolApprovals({
      actions: [{ type: "deposit", token: padded, amount: "1" }],
      poolFee: fee,
      poolAddress: POOL,
    });
    expect(approvals).toHaveLength(1);
    expect(approvedLow(approvals[0])).toBe("7");
  });

  it("gives a non-STRK deposit its own approval beside the fee", () => {
    const approvals = poolApprovals({
      actions: [{ type: "deposit", token: USDC, amount: "40" }],
      poolFee: fee,
      poolAddress: POOL,
    });
    expect(approvals).toHaveLength(2);
    expect(approvals[0].contractAddress).toBe(STRK_ADDRESS);
    expect(approvedLow(approvals[0])).toBe("6");
    expect(BigInt(approvals[1].contractAddress)).toBe(BigInt(USDC));
    expect(approvedLow(approvals[1])).toBe("40");
  });

  it("sums repeated deposits of the same token into one approval", () => {
    const approvals = poolApprovals({
      actions: [
        { type: "deposit", token: USDC, amount: "40" },
        { type: "deposit", token: USDC, amount: "2" },
      ] as Strk20Action[],
      poolFee: fee,
      poolAddress: POOL,
    });
    expect(approvals).toHaveLength(2);
    expect(approvedLow(approvals[1])).toBe("42");
  });
});
