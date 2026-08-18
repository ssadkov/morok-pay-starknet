import { CCTP_DOMAIN_BASE } from "@/lib/cctp/constants";
import { defaultAppNetwork, type AppNetwork } from "@/lib/network";

export type CctpMessage = {
  status?: string;
  message?: string;
  attestation?: string;
};

export function parseSourceDomain(
  value: string | null,
  fallback = CCTP_DOMAIN_BASE,
) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid source domain");
  }
  const domain = Number(value);
  if (domain > 255) {
    throw new Error("Invalid source domain");
  }
  return domain;
}

export async function fetchAttestation(
  transactionHash: string,
  sourceDomain = CCTP_DOMAIN_BASE,
  network: AppNetwork = defaultAppNetwork(),
) {
  const params = new URLSearchParams({
    transactionHash,
    sourceDomain: String(sourceDomain),
    network,
  });
  const response = await fetch(`/api/cctp/attestation?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Circle attestation is not available yet");
  }
  const body = (await response.json()) as { messages?: CctpMessage[] };
  const entry = body.messages?.[0];
  if (!entry?.message || !entry.attestation) return null;
  if (entry.status && entry.status !== "complete") return null;
  return { message: entry.message, attestation: entry.attestation };
}

export async function waitForAttestation(
  transactionHash: string,
  options?: {
    sourceDomain?: number;
    network?: AppNetwork;
    signal?: AbortSignal;
    intervalMs?: number;
  },
) {
  const intervalMs = options?.intervalMs ?? 8_000;
  const sourceDomain = options?.sourceDomain ?? CCTP_DOMAIN_BASE;
  const network = options?.network ?? defaultAppNetwork();
  while (!options?.signal?.aborted) {
    const attestation = await fetchAttestation(
      transactionHash,
      sourceDomain,
      network,
    ).catch(() => null);
    if (attestation) return attestation;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Stopped waiting for the Circle attestation");
}
