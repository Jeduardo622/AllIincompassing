import { getOptionalServerEnv } from "../env";

type RateLimitOptions = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
};

type RateLimitResult =
  | { limited: false; retryAfterSeconds: null; mode: "memory" | "distributed" | "waf_only" }
  | { limited: true; retryAfterSeconds: number; mode: "memory" | "distributed" | "waf_only" };

type LocalRateLimitState = {
  count: number;
  resetAtMs: number;
};

const localRateState = new Map<string, LocalRateLimitState>();

const getMode = (): "memory" | "distributed" | "waf_only" => {
  const configured = (getOptionalServerEnv("RATE_LIMIT_MODE") ?? "").trim().toLowerCase();
  if (configured === "distributed" || configured === "waf_only" || configured === "memory") {
    return configured;
  }
  return "memory";
};

const getRedisConfig = (): { baseUrl: string; token: string } | null => {
  const baseUrl = getOptionalServerEnv("UPSTASH_REDIS_REST_URL");
  const token = getOptionalServerEnv("UPSTASH_REDIS_REST_TOKEN");
  if (!baseUrl || !token) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
};

const extractClientKey = (request: Request): string => {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return `ip:${cfConnectingIp}`;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return `ip:${forwardedFor}`;

  return "anonymous";
};

const pruneLocalState = (now: number, maxEntries = 5000): void => {
  for (const [key, state] of localRateState.entries()) {
    if (state.resetAtMs <= now) {
      localRateState.delete(key);
    }
  }
  if (localRateState.size <= maxEntries) return;

  const entries = Array.from(localRateState.entries()).sort((a, b) => a[1].resetAtMs - b[1].resetAtMs);
  const overflow = localRateState.size - maxEntries;
  for (let index = 0; index < overflow; index += 1) {
    const candidate = entries[index];
    if (!candidate) return;
    localRateState.delete(candidate[0]);
  }
};

const consumeLocalRateLimit = (request: Request, options: RateLimitOptions): RateLimitResult => {
  const now = Date.now();
  pruneLocalState(now);
  const identityKey = `${options.keyPrefix}:${extractClientKey(request)}`;
  const existing = localRateState.get(identityKey);

  if (!existing || existing.resetAtMs <= now) {
    localRateState.set(identityKey, {
      count: 1,
      resetAtMs: now + options.windowMs,
    });
    return { limited: false, retryAfterSeconds: null, mode: "memory" };
  }

  existing.count += 1;
  localRateState.set(identityKey, existing);
  if (existing.count > options.maxRequests) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
      mode: "memory",
    };
  }
  return { limited: false, retryAfterSeconds: null, mode: "memory" };
};

const consumeDistributedRateLimit = async (
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult | null> => {
  const redis = getRedisConfig();
  if (!redis) {
    return null;
  }

  const identityKey = `${options.keyPrefix}:${extractClientKey(request)}`;
  const ttlSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  const pipelineUrl = `${redis.baseUrl}/pipeline`;

  const pipelineBody = [
    ["INCR", identityKey],
    ["EXPIRE", identityKey, ttlSeconds, "NX"],
    ["TTL", identityKey],
  ];

  const response = await fetch(pipelineUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pipelineBody),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as Array<{ result?: unknown }>;
  const count = Number(payload[0]?.result ?? 0);
  const ttl = Number(payload[2]?.result ?? ttlSeconds);
  const retryAfterSeconds = Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : ttlSeconds;

  if (!Number.isFinite(count) || count <= options.maxRequests) {
    return { limited: false, retryAfterSeconds: null, mode: "distributed" };
  }

  return { limited: true, retryAfterSeconds, mode: "distributed" };
};

export async function consumeRateLimit(request: Request, options: RateLimitOptions): Promise<RateLimitResult> {
  const mode = getMode();
  if (mode === "waf_only") {
    return { limited: false, retryAfterSeconds: null, mode: "waf_only" };
  }

  if (mode === "distributed") {
    const distributed = await consumeDistributedRateLimit(request, options);
    if (distributed) {
      return distributed;
    }
  }

  return consumeLocalRateLimit(request, options);
}

export function resetRateLimitsForTests(): void {
  localRateState.clear();
}

