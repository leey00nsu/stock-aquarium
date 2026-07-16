import 'server-only';

interface IpLimitState {
  active: number;
  attempts: number[];
  lastSeenAt: number;
}

interface SseLimitState {
  active: number;
  attempts: number[];
  byIp: Map<string, IpLimitState>;
}

type Admission =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfterSeconds: number };

const WINDOW_MS = 60_000;
const IP_STATE_TTL_MS = 10 * 60_000;

function readLimit(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

const MAX_CONNECTIONS = readLimit('SSE_MAX_CONNECTIONS', 500, 10_000);
const MAX_GLOBAL_ATTEMPTS_PER_MINUTE = readLimit(
  'SSE_MAX_GLOBAL_ATTEMPTS_PER_MINUTE',
  2_000,
  100_000,
);
const MAX_CONNECTIONS_PER_IP = readLimit('SSE_MAX_CONNECTIONS_PER_IP', 12, 1_000);
const MAX_ATTEMPTS_PER_IP_PER_MINUTE = readLimit(
  'SSE_MAX_ATTEMPTS_PER_IP_PER_MINUTE',
  30,
  10_000,
);
const TRUST_PROXY_HEADERS = process.env.SSE_TRUST_PROXY_HEADERS === 'true';

const globalForSseLimit = globalThis as typeof globalThis & {
  __kisSseLimitState?: SseLimitState;
};

const state = globalForSseLimit.__kisSseLimitState ?? {
  active: 0,
  attempts: [],
  byIp: new Map<string, IpLimitState>(),
};
globalForSseLimit.__kisSseLimitState = state;

function recentAttempts(attempts: number[], now: number) {
  return attempts.filter((timestamp) => now - timestamp < WINDOW_MS);
}

function retryAfterSeconds(attempts: number[], now: number) {
  const oldest = attempts[0];
  return oldest ? Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1_000)) : 1;
}

function trustedClientIp(request: Request) {
  if (!TRUST_PROXY_HEADERS) return null;
  const value = request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0];
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 128) : null;
}

function cleanupIpStates(now: number) {
  for (const [ip, ipState] of state.byIp) {
    if (ipState.active === 0 && now - ipState.lastSeenAt > IP_STATE_TTL_MS) {
      state.byIp.delete(ip);
    }
  }
}

export function acquireSseConnection(request: Request): Admission {
  const now = Date.now();
  state.attempts = recentAttempts(state.attempts, now);
  cleanupIpStates(now);

  if (state.attempts.length >= MAX_GLOBAL_ATTEMPTS_PER_MINUTE) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds(state.attempts, now) };
  }
  state.attempts.push(now);

  if (state.active >= MAX_CONNECTIONS) {
    return { allowed: false, retryAfterSeconds: 5 };
  }

  const ip = trustedClientIp(request);
  let ipState: IpLimitState | null = null;
  if (ip) {
    ipState = state.byIp.get(ip) ?? { active: 0, attempts: [], lastSeenAt: now };
    ipState.attempts = recentAttempts(ipState.attempts, now);
    ipState.lastSeenAt = now;
    state.byIp.set(ip, ipState);

    if (ipState.attempts.length >= MAX_ATTEMPTS_PER_IP_PER_MINUTE) {
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(ipState.attempts, now) };
    }
    ipState.attempts.push(now);
    if (ipState.active >= MAX_CONNECTIONS_PER_IP) {
      return { allowed: false, retryAfterSeconds: 5 };
    }
    ipState.active += 1;
  }

  state.active += 1;
  let released = false;
  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      if (ipState) {
        ipState.active = Math.max(0, ipState.active - 1);
        ipState.lastSeenAt = Date.now();
      }
    },
  };
}

export function getSseLimitStatus() {
  return {
    activeConnections: state.active,
    maxConnections: MAX_CONNECTIONS,
    trustedProxyHeaders: TRUST_PROXY_HEADERS,
  };
}
