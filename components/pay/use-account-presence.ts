"use client";

import { useEffect, useState } from "react";

import { useNetwork } from "@/components/network-provider";
import {
  accountPresence,
  type AccountPresence,
} from "@/lib/starknet/account-status";

/** Whether an address exists on the selected network. */
export function useAccountPresence(address: string | undefined): AccountPresence {
  const { network } = useNetwork();
  const key = address ? `${network}:${address.toLowerCase()}` : "";
  const [result, setResult] = useState<{
    key: string;
    value: AccountPresence;
  }>({ key: "", value: "unknown" });

  useEffect(() => {
    if (!address) return;
    const target = address;
    let cancelled = false;
    async function load() {
      try {
        const value = await accountPresence(network, target);
        if (!cancelled) setResult({ key, value });
        return value;
      } catch {
        return "unknown" as const;
      }
    }
    void load();
    const id = window.setInterval(() => {
      void load().then((value) => {
        if (value === "deployed") window.clearInterval(id);
      });
    }, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [network, address, key]);

  return result.key === key ? result.value : "unknown";
}
