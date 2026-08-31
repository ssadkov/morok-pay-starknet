"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useTreasury } from "@/components/treasury/treasury-context";

/**
 * Sends an unfinished EVM wallet to the one screen that can finish it.
 *
 * This used to be a dialog that deployed and registered by itself. That was
 * the wrong shape twice over: it appeared on top of whatever the person was
 * trying to do, and it only knew about the two steps it performed - so once
 * bridging and buying STRK became part of getting in, it could take someone as
 * far as an account with no STRK and then stop, with the rest of the way
 * scattered across other pages.
 *
 * `/start` reads the chain and knows every step, so this is now a redirect and
 * nothing else. Everywhere that raised the gate still raises it; the effect is
 * that the app takes you to where the work is, instead of interrupting you
 * where you were.
 */
export function EvmOnboardingGate() {
  const { evmGate, dismissEvmGate } = useTreasury();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!evmGate) return;
    /* Clearing it either way: on /start the flag has nothing left to do, and
       redirecting onto the current page would fight with whatever step the
       person is part-way through. */
    dismissEvmGate();
    if (pathname !== "/start") router.push("/start");
  }, [dismissEvmGate, evmGate, pathname, router]);

  return null;
}
