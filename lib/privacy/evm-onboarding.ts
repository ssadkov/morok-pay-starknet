import {
  eth712Strk20ClassMode,
  type Eth712AccountInspection,
} from "@/lib/privacy/eth712-account";
import type { PoolRegistration } from "@/lib/starknet/account-status";

export type EvmReadiness =
  | { status: "ready"; starknetAddress: string }
  | {
      status: "onboarding";
      starknetAddress: string;
      reason: "undeployed" | "upgrade" | "unregistered" | "unsupported";
      message: string;
    };

export function classifyEvmReadiness(
  inspection: Eth712AccountInspection,
  registration: PoolRegistration | null,
): EvmReadiness {
  if (!inspection.deployed) {
    return {
      status: "onboarding",
      starknetAddress: inspection.starknetAddress,
      reason: "undeployed",
      message: "Your deterministic Starknet account has not been deployed yet.",
    };
  }
  const classMode = inspection.deployedClassHash
    ? eth712Strk20ClassMode(inspection.deployedClassHash)
    : "unsupported";
  if (classMode !== "compatible") {
    return {
      status: "onboarding",
      starknetAddress: inspection.starknetAddress,
      reason: classMode === "atomic_upgrade_required" ? "upgrade" : "unsupported",
      message:
        classMode === "atomic_upgrade_required"
          ? "Your Starknet account needs the STRK20-compatible upgrade."
          : "This Starknet account class is not supported by the EVM privacy flow.",
    };
  }
  if (registration !== "registered") {
    return {
      status: "onboarding",
      starknetAddress: inspection.starknetAddress,
      reason: "unregistered",
      message:
        registration === "unknown"
          ? "MorokPay could not confirm the privacy registration yet."
          : "Your Starknet account has not activated STRK20 privacy yet.",
    };
  }
  return { status: "ready", starknetAddress: inspection.starknetAddress };
}
