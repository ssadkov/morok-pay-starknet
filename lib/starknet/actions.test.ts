import { describe, expect, it } from "vitest";

import { STRK_ADDRESS } from "./constants";
import {
  claimFromEscrow,
  depositToEscrow,
  publicStrkTransferCall,
  toCalldataFelt,
} from "./actions";
import { OPEN_NOTE, OPEN_NOTE_ID } from "../privacy/evm-strk20-account";
import { getShieldToken } from "./tokens";

const WALLET_FELT_RE = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

describe("toCalldataFelt", () => {
  it("keeps zero as 0x0", () => {
    expect(toCalldataFelt("0x0")).toBe("0x0");
    expect(toCalldataFelt(BigInt(0))).toBe("0x0");
  });

  it("strips the leading zeros Ready rejects in invoke calldata", () => {
    const padded =
      "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343";
    const felt = toCalldataFelt(padded);
    expect(felt.startsWith("0x0")).toBe(false);
    expect(WALLET_FELT_RE.test(felt)).toBe(true);
    expect(BigInt(felt)).toBe(BigInt(padded));
  });

  it("leaves an already-canonical felt alone", () => {
    expect(toCalldataFelt("0x1")).toBe("0x1");
  });
});

describe("publicStrkTransferCall", () => {
  it("builds a standard STRK transfer with u256 calldata", () => {
    const recipient =
      "0x00E5887fC74A11d10Ad5dd2f69D3911Fb352d9b811528a9281Ca8aBAc8498423";
    expect(publicStrkTransferCall(recipient, BigInt(10) ** BigInt(16))).toEqual({
      contractAddress: STRK_ADDRESS,
      entrypoint: "transfer",
      calldata: [
        expect.stringMatching(/^0x[0-9a-f]+$/),
        "0x2386f26fc10000",
        "0x0",
      ],
    });
  });
});

/**
 * Enough of each rail to record what it was asked to do. Ready X's method
 * takes one argument, the EVM session takes two, and only the second is
 * detected by `signOutsideExecution` being present.
 */
function readyAccount() {
  const calls: unknown[][] = [];
  return {
    calls,
    strk20InvokeTransaction: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ transaction_hash: "0x1" });
    },
  };
}

function evmAccount() {
  return Object.assign(readyAccount(), {
    signOutsideExecution: () => Promise.resolve({}),
  });
}

const ESCROW = "0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5";
const OWNER = "0x9294eb7876e92e73f73977d844843654fca6fe85c746d56a90fa8f1d2f5c1a";
const SECRET = "0x2a";

describe("depositToEscrow", () => {
  it("withdraws to the helper and records the commitment in one set", async () => {
    const account = evmAccount();
    const usdc = getShieldToken("usdc", "sepolia");
    await depositToEscrow(account, usdc, BigInt(50), ESCROW, "0x7");

    const [actions] = account.calls[0] as [Array<Record<string, unknown>>];
    expect(actions.map((action) => action.type)).toEqual(["withdraw", "invoke"]);
    expect(actions[0]).toMatchObject({ amount: "0x32" });
    /* Deposit is enum variant 0, and the escrow ignores secret and note id. */
    expect(actions[1].calldata).toEqual(["0x0", "0x7", expect.any(String), "0x32", "0x0", "0x0"]);
  });
});

describe("claimFromEscrow", () => {
  it("asks for an open note and claims into it", async () => {
    const account = readyAccount();
    const usdc = getShieldToken("usdc", "sepolia");
    await claimFromEscrow(account, usdc, OWNER, ESCROW, SECRET);

    const [actions] = account.calls[0] as [Array<Record<string, unknown>>];
    expect(actions.map((action) => action.type)).toEqual(["transfer", "invoke"]);
    expect(actions[0]).toMatchObject({ amount: OPEN_NOTE });
    /* Claim is variant 1, and the note it deposits into is the open note this
       same set creates - substituted once the set is compiled. */
    expect(actions[1].calldata).toEqual(["0x1", "0x0", "0x0", "0x0", SECRET, OPEN_NOTE_ID]);
  });

  it("passes no submission options to Ready X, which has no relayer", async () => {
    const account = readyAccount();
    await claimFromEscrow(
      account,
      getShieldToken("usdc", "sepolia"),
      OWNER,
      ESCROW,
      SECRET,
      { register: true, relay: true },
    );
    expect(account.calls[0]).toHaveLength(1);
  });

  it("folds registration into the same set for a first-time EVM claimer", async () => {
    const account = evmAccount();
    await claimFromEscrow(
      account,
      getShieldToken("usdc", "sepolia"),
      OWNER,
      ESCROW,
      SECRET,
      { register: true, relay: true },
    );

    const [actions, submit] = account.calls[0] as [
      Array<Record<string, unknown>>,
      { relay?: boolean },
    ];
    expect(actions.map((action) => action.type)).toEqual([
      "register",
      "setup",
      "transfer",
      "invoke",
    ]);
    expect(submit).toEqual({ relay: true });
  });

  it("skips registration for a claimer already in the pool", async () => {
    const account = evmAccount();
    await claimFromEscrow(
      account,
      getShieldToken("usdc", "sepolia"),
      OWNER,
      ESCROW,
      SECRET,
      { register: false, relay: true },
    );
    const [actions] = account.calls[0] as [Array<Record<string, unknown>>];
    expect(actions.map((action) => action.type)).toEqual(["transfer", "invoke"]);
  });
});
