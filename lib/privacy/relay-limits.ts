/**
 * How often one caller, and everyone together, may spend the relayer's money.
 *
 * A proven action set is bearer: anyone holding one can submit it, and every
 * submission costs us the pool fee plus gas. The endpoint deliberately learns
 * nothing about who is asking - that is the point of relaying - so the only
 * things left to limit by are the caller's IP and the clock.
 *
 * The counters live in the process, so on serverless they are per-instance and
 * a determined caller spread across instances gets more than one instance's
 * share. They are a brake, not a lock; the balance floor in relay-submission.ts
 * is what actually bounds the loss.
 */

export type RelayWindow = { count: number; resetAt: number };

export const RELAY_WINDOW_MS = 60 * 60 * 1000;
/*
 * 5 blocked the organizer's own payout run: ten first-time contest prizes
 * submitted from one browser hit it on the fifth. 20 covers a ten-entrant
 * campaign from a single IP with room to retry a couple of failures, without
 * opening the door to a real scrape - revisit once payouts happen from
 * something other than one person's browser.
 */
export const RELAY_PER_CALLER = 20;
export const RELAY_PER_WINDOW = 60;

export type RelayVerdict =
  | { allowed: true }
  | { allowed: false; scope: "caller" | "global"; retryAfterSeconds: number };

function take(
  store: Map<string, RelayWindow>,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const window = store.get(key);
  if (!window || now >= window.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (window.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
    };
  }
  window.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Counts the request against both budgets. The global budget is only charged
 * once the caller's own budget has room, so one caller hammering the endpoint
 * cannot exhaust everyone else's allowance on requests it was refused anyway.
 */
export function chargeRelayBudget(args: {
  store: Map<string, RelayWindow>;
  caller: string;
  now: number;
  windowMs?: number;
  perCaller?: number;
  perWindow?: number;
}): RelayVerdict {
  const windowMs = args.windowMs ?? RELAY_WINDOW_MS;
  const perCaller = take(
    args.store,
    `caller:${args.caller}`,
    args.now,
    args.perCaller ?? RELAY_PER_CALLER,
    windowMs,
  );
  if (!perCaller.allowed) {
    return {
      allowed: false,
      scope: "caller",
      retryAfterSeconds: perCaller.retryAfterSeconds,
    };
  }
  const global = take(
    args.store,
    "global",
    args.now,
    args.perWindow ?? RELAY_PER_WINDOW,
    windowMs,
  );
  if (!global.allowed) {
    return {
      allowed: false,
      scope: "global",
      retryAfterSeconds: global.retryAfterSeconds,
    };
  }
  return { allowed: true };
}

/**
 * The caller's address, for rate-limiting only. Behind Vercel the first entry
 * of `x-forwarded-for` is the client; an absent header means an unknown caller,
 * and they all share one bucket rather than each getting a fresh one.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}
