/**
 * Currently unreferenced. The card that used it was taken off My QR on
 * 2026-08-30 so the contest page would not open with a paragraph about a
 * feature Ready X cannot do yet. The check itself passed on a real wallet and
 * is what wiring an anonymous receive account on Ready X would start from, so
 * it is kept rather than deleted.
 */
"use client";

import { useCallback, useState } from "react";
import type { Signature } from "starknet";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import {
  deriveReceiveAccount,
  readyReceiveAccountTypedData,
  signatureEntropy,
  signaturesMatch,
} from "@/lib/privacy/receive-account";

/**
 * Whether Ready X can safely stand up an anonymous `B`, checked rather than
 * assumed.
 *
 * `B`'s address has to be reproducible from the wallet alone - the same
 * signature every time, on any device - or donations land on an account
 * nobody can get back to. MetaMask's determinism is load-bearing elsewhere in
 * this app already; Ready X's has never been exercised for this. So this asks
 * the connected Ready X wallet to sign the exact same message twice and
 * compares the results, before anything is deployed or a single wei of
 * relayer STRK is spent.
 *
 * Deliberately its own button rather than folded into the EVM flow: a
 * negative result here is informative, not a failure to recover from, and it
 * should never block or delay the MetaMask path.
 */

export type ReadyAnonymityCheckStatus =
  | "idle"
  | "checking"
  | "deterministic"
  | "not_deterministic"
  | "error";

export type ReadyAnonymityCheckState = {
  status: ReadyAnonymityCheckStatus;
  /** Only meaningful once the check has passed - nothing was deployed for it. */
  address: string | null;
  error: string | null;
};

export function useReadyAnonymityCheck(): ReadyAnonymityCheckState & {
  check: () => Promise<void>;
} {
  const { network } = useNetwork();
  const { session } = useTreasury();
  const [status, setStatus] = useState<ReadyAnonymityCheckStatus>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!session || session.kind !== "ready") return;
    setStatus("checking");
    setError(null);
    setAddress(null);
    try {
      const typedData = readyReceiveAccountTypedData({ network });
      const sign = (): Promise<Signature> =>
        session.account.signMessage(typedData);
      const first = await sign();
      const second = await sign();
      if (!signaturesMatch(first, second)) {
        setStatus("not_deterministic");
        return;
      }
      const derived = deriveReceiveAccount(signatureEntropy(first));
      setAddress(derived.address);
      setStatus("deterministic");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not ask Ready X to sign the check message.",
      );
      setStatus("error");
    }
  }, [session, network]);

  return { status, address, error, check };
}
