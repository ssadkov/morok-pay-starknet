"use client";

import { useEffect, useState } from "react";

import { useNetwork } from "@/components/network-provider";
import {
  poolRegistration,
  type PoolRegistration,
} from "@/lib/starknet/account-status";

/** Whether an address has registered a STRK20 viewing key on this network. */
export function usePoolRegistration(
  address: string | undefined,
): PoolRegistration {
  const { network } = useNetwork();
  const key = address ? `${network}:${address.toLowerCase()}` : "";
  const [result, setResult] = useState<{
    key: string;
    value: PoolRegistration;
  }>({ key: "", value: "unknown" });

  useEffect(() => {
    if (!address) return;
    const target = address;
    let cancelled = false;
    async function load() {
      const value = await poolRegistration(network, target);
      if (!cancelled) setResult({ key, value });
      return value;
    }
    void load();
    const id = window.setInterval(() => {
      void load().then((value) => {
        if (value === "registered") window.clearInterval(id);
      });
    }, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [network, address, key]);

  return result.key === key ? result.value : "unknown";
}
