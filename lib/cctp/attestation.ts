export type CctpMessage = {
  status?: string;
  message?: string;
  attestation?: string;
};

export async function fetchAttestation(transactionHash: string) {
  const response = await fetch(
    `/api/cctp/attestation?transactionHash=${encodeURIComponent(transactionHash)}`,
  );
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
  options?: { signal?: AbortSignal; intervalMs?: number },
) {
  const intervalMs = options?.intervalMs ?? 8_000;
  while (!options?.signal?.aborted) {
    const attestation = await fetchAttestation(transactionHash).catch(
      () => null,
    );
    if (attestation) return attestation;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Stopped waiting for the Circle attestation");
}
