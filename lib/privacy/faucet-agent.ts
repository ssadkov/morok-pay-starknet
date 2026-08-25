import { createHash } from "node:crypto";

const FAUCET_BASE = "https://api.faucet.starknet.io";
const REQUEST_TIMEOUT_MS = 15_000;

type FaucetEnvelope<T> = {
  status?: string;
  data?: T;
  message?: string;
};

export type FaucetChallenge = {
  challengeId: string;
  difficulty: number;
  expiresAt: string;
  powInputPrefix: string;
};

export type FaucetRequest = {
  requestId: string;
  pollAfterSeconds: number;
};

export type FaucetStatus = {
  jobStatus: string;
  txHash?: string;
  pollAfterSeconds?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function faucetFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${FAUCET_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as
    | FaucetEnvelope<T>
    | null;
  if (!response.ok || !payload || payload.status !== "success" || !payload.data) {
    throw new Error(
      response.status === 429
        ? "The Starknet faucet quota or cooldown is active"
        : "The Starknet faucet rejected the request",
    );
  }
  return payload.data;
}

export function hasLeadingZeroBits(hash: Uint8Array, difficulty: number) {
  if (!Number.isInteger(difficulty) || difficulty < 0) return false;
  const fullBytes = Math.floor(difficulty / 8);
  const remainingBits = difficulty % 8;
  if (difficulty > hash.length * 8) return false;
  for (let index = 0; index < fullBytes; index += 1) {
    if (hash[index] !== 0) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (hash[fullBytes] & mask) === 0;
}

export function solvePowChallenge(args: {
  prefix: string;
  difficulty: number;
  deadline: number;
}) {
  if (
    !Number.isInteger(args.difficulty) ||
    args.difficulty < 1 ||
    args.difficulty > 24
  ) {
    throw new Error("Unsupported faucet proof-of-work difficulty");
  }
  for (let nonce = 0; nonce < Number.MAX_SAFE_INTEGER; nonce += 1) {
    if ((nonce & 0x3fff) === 0 && Date.now() >= args.deadline) {
      throw new Error("The faucet proof-of-work challenge expired");
    }
    const digest = createHash("sha256")
      .update(`${args.prefix}${nonce}`)
      .digest();
    if (hasLeadingZeroBits(digest, args.difficulty)) return String(nonce);
  }
  throw new Error("Could not solve the faucet proof-of-work challenge");
}

function parseChallenge(value: unknown, userAddress: string): FaucetChallenge {
  if (!isRecord(value)) throw new Error("Invalid faucet challenge");
  const { challengeId, difficulty, expiresAt, powInputPrefix } = value;
  if (
    typeof challengeId !== "string" ||
    !/^[0-9a-f-]{20,80}$/i.test(challengeId) ||
    typeof difficulty !== "number" ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof powInputPrefix !== "string" ||
    !powInputPrefix.toLowerCase().includes(userAddress.toLowerCase())
  ) {
    throw new Error("Invalid faucet challenge");
  }
  return { challengeId, difficulty, expiresAt, powInputPrefix };
}

export async function requestFaucetFunding(userAddress: string) {
  const startedAt = Date.now();
  const challenge = parseChallenge(
    await faucetFetch<unknown>("/api/public-agent/pow/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userAddress }),
    }),
    userAddress,
  );
  const expiry = Date.parse(challenge.expiresAt);
  // Leave time inside the 60-second route budget to submit the solved proof.
  const deadline = Math.min(expiry - 5_000, startedAt + 40_000);
  if (deadline <= Date.now()) throw new Error("The faucet challenge expired");
  const nonce = solvePowChallenge({
    prefix: challenge.powInputPrefix,
    difficulty: challenge.difficulty,
    deadline,
  });
  const value = await faucetFetch<unknown>("/api/public-agent/faucet/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userAddress,
      challengeId: challenge.challengeId,
      nonce,
    }),
  });
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f-]{20,80}$/i.test(value.requestId) ||
    typeof value.pollAfterSeconds !== "number"
  ) {
    throw new Error("Invalid faucet request response");
  }
  return {
    requestId: value.requestId,
    pollAfterSeconds: Math.max(1, Math.min(30, value.pollAfterSeconds)),
  } satisfies FaucetRequest;
}

export async function readFaucetStatus(requestId: string) {
  if (!/^[0-9a-f-]{20,80}$/i.test(requestId)) {
    throw new Error("Invalid faucet request id");
  }
  const value = await faucetFetch<unknown>(
    `/api/public-agent/faucet/status/${encodeURIComponent(requestId)}`,
  );
  if (!isRecord(value) || typeof value.jobStatus !== "string") {
    throw new Error("Invalid faucet status response");
  }
  return {
    jobStatus: value.jobStatus,
    txHash: typeof value.txHash === "string" ? value.txHash : undefined,
    pollAfterSeconds:
      typeof value.pollAfterSeconds === "number"
        ? Math.max(1, Math.min(30, value.pollAfterSeconds))
        : undefined,
  } satisfies FaucetStatus;
}
