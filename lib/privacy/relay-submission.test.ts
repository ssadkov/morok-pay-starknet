import { describe, expect, it } from "vitest";

import { starknetOf } from "@/lib/starknet/constants";

import {
  chargeRelayBudget,
  callerKey,
  type RelayWindow,
} from "./relay-limits";
import {
  parseRelayRequest,
  relayFloor,
  RelayRejected,
} from "./relay-submission";

const pool = starknetOf("sepolia").pool;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    network: "sepolia",
    call: {
      contractAddress: pool,
      entrypoint: "apply_actions",
      calldata: ["0x1", "0x2"],
    },
    proof: "AQICKLUv",
    proofFacts: ["0x50524f4f4631", "0x1"],
    ...overrides,
  };
}

describe("what the relayer agrees to pay for", () => {
  it("accepts an apply_actions call on this network's pool", () => {
    expect(parseRelayRequest(validBody(), "sepolia")).toMatchObject({
      call: { entrypoint: "apply_actions", calldata: ["0x1", "0x2"] },
      proofFacts: ["0x50524f4f4631", "0x1"],
    });
  });

  it("refuses a call to any other contract", () => {
    expect(() =>
      parseRelayRequest(
        validBody({
          call: {
            contractAddress: "0x1",
            entrypoint: "apply_actions",
            calldata: ["0x1"],
          },
        }),
        "sepolia",
      ),
    ).toThrow(RelayRejected);
  });

  it("refuses the mainnet pool on a sepolia request", () => {
    expect(() =>
      parseRelayRequest(
        validBody({
          call: {
            contractAddress: starknetOf("mainnet").pool,
            entrypoint: "apply_actions",
            calldata: ["0x1"],
          },
        }),
        "sepolia",
      ),
    ).toThrow(/only submits to the sepolia/i);
  });

  it("refuses any entrypoint other than apply_actions", () => {
    expect(() =>
      parseRelayRequest(
        validBody({
          call: {
            contractAddress: pool,
            entrypoint: "set_fee_amount",
            calldata: ["0x1"],
          },
        }),
        "sepolia",
      ),
    ).toThrow(/only submits apply_actions/i);
  });

  it("refuses a proof the pool would not accept", () => {
    expect(() =>
      parseRelayRequest(validBody({ proofFacts: ["0x1"] }), "sepolia"),
    ).toThrow(/unsupported proof version/i);
    expect(() =>
      parseRelayRequest(validBody({ proofFacts: [] }), "sepolia"),
    ).toThrow(/no proof facts/i);
    expect(() => parseRelayRequest(validBody({ proof: "" }), "sepolia")).toThrow(
      /no proof/i,
    );
  });

  it("refuses calldata that is not felts", () => {
    expect(() =>
      parseRelayRequest(
        validBody({
          call: { contractAddress: pool, entrypoint: "apply_actions", calldata: ["hello"] },
        }),
        "sepolia",
      ),
    ).toThrow(RelayRejected);
  });
});

describe("when the relayer stops", () => {
  it("holds back exactly one submission's worth, not a round reserve", () => {
    const strk = 10n ** 18n;
    expect(relayFloor(2n * strk, 12n * strk)).toBe(14n * strk);
    expect(relayFloor(6n * strk, 12n * strk)).toBe(18n * strk);
  });
});

describe("how often the relayer will spend", () => {
  it("stops one caller at their allowance and lets another through", () => {
    const store = new Map<string, RelayWindow>();
    const charge = (caller: string) =>
      chargeRelayBudget({ store, caller, now: 1_000, perCaller: 2, perWindow: 10 });
    expect(charge("a").allowed).toBe(true);
    expect(charge("a").allowed).toBe(true);
    const refused = charge("a");
    expect(refused.allowed).toBe(false);
    expect(refused).toMatchObject({ scope: "caller" });
    expect(charge("b").allowed).toBe(true);
  });

  it("does not charge the shared allowance for a request it refused", () => {
    const store = new Map<string, RelayWindow>();
    const args = { store, caller: "a", now: 1_000, perCaller: 1, perWindow: 5 };
    expect(chargeRelayBudget(args).allowed).toBe(true);
    expect(chargeRelayBudget(args).allowed).toBe(false);
    expect(chargeRelayBudget(args).allowed).toBe(false);
    /* One global slot spent, not three - so the refused caller cannot burn
       everyone else's allowance. */
    expect(store.get("global")?.count).toBe(1);
  });

  it("reopens the allowance once the window has passed", () => {
    const store = new Map<string, RelayWindow>();
    const at = (now: number) =>
      chargeRelayBudget({ store, caller: "a", now, perCaller: 1, windowMs: 100 });
    expect(at(0).allowed).toBe(true);
    expect(at(50).allowed).toBe(false);
    expect(at(150).allowed).toBe(true);
  });

  it("reads the client address from the proxy header, and pools unknowns", () => {
    expect(callerKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe(
      "1.2.3.4",
    );
    expect(callerKey(new Headers())).toBe("unknown");
  });
});
