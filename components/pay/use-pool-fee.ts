"use client";

import { useEffect, useState } from "react";

import { useNetwork } from "@/components/network-provider";
import {
  cachedPoolFee,
  FALLBACK_POOL_FEE,
  readPoolFee,
} from "@/lib/starknet/pool-fee";

/** Pool fee in wei. Falls back to the Sepolia amount until the RPC answers. */
export function usePoolFee(): bigint {
  const { network } = useNetwork();
  const [, setLoaded] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readPoolFee(network)
      .then(() => {
        if (!cancelled) setLoaded((value) => value + 1);
      })
      .catch(() => {
        // Keep the fallback; shielding still guards against a short balance.
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  return cachedPoolFee(network) ?? FALLBACK_POOL_FEE;
}
