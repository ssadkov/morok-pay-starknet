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
  const [presence, setPresence] = useState<AccountPresence>("unknown");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    accountPresence(network, address)
      .then((value) => {
        if (!cancelled) setPresence(value);
      })
      .catch(() => {
        // Leave it unknown; the UI only warns on a definite answer.
      });
    return () => {
      cancelled = true;
    };
  }, [network, address]);

  return presence;
}
