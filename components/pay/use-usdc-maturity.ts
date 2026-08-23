"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useNetwork } from "@/components/network-provider";
import { subscribeActivity } from "@/lib/pay/activity";
import {
  formatRemaining,
  latestUsdcShieldAt,
  usdcNoteReady,
} from "@/lib/pay/maturity";

export function useUsdcMaturity(
  address: string | undefined,
  privateUsdc: bigint,
) {
  const { network } = useNetwork();
  const [now, setNow] = useState(() => Date.now());
  const lastShieldAt = useSyncExternalStore(
    subscribeActivity,
    () => (address ? latestUsdcShieldAt(network, address) : null),
    () => null,
  );

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const state = usdcNoteReady({
    privateUsdc,
    lastShieldAt,
    now,
  });
  return {
    ...state,
    remainingLabel: formatRemaining(state.remainingMs),
  };
}
