# WIN-39 — Distributed auth rate limiting & auth-log minimization (design only)

**Status:** Design complete (closes Linear **WIN-39** as review-only).  
**Parent spec:** `AUTH_ROUTE_HARDENING_SPEC_2026_03_13.md` (P2 follow-ups).  
**Implementation:** Out of scope for this document; follow-up issues must route `critical` and touch `supabase/functions/**`.

## 1. Current state (baseline)

- **Rate limiting:** `supabase/functions/lib/http/error.ts` exports `rateLimit()` backed by a **process-local `Map`**. Each Edge Function instance maintains its own counters.
- **Auth usage:**
  - `auth-login`: IP bucket `20 / 60s`, identity (email) bucket `8 / 60s` (`auth-login/index.ts`).
  - `auth-signup`: IP `10 / 60s`, identity `4 / 60s` (`auth-signup/index.ts`).
- **Risk of in-memory limiter:** Under load or many warm instances, limits are **weaker than the numbers suggest** (attack traffic spreads across instances). After cold starts, counters reset. This is acceptable as a **best-effort** layer until P2 ships; it is **not** a distributed guarantee.

## 2. Shared-store rate limiting — options and failure modes

| Option | Consistency | Typical latency | Ops / cost | Failure modes |
|--------|-------------|-----------------|------------|----------------|
| **A. HTTP Redis (e.g. Upstash)** | Strong per key (single regional endpoint) | +1–5 ms RTT per check | Vendor billing; secrets in Edge env | Vendor outage: see §2.1. Key hot-spots: throttle at Redis. |
| **B. Postgres atomic counters** (dedicated narrow table + `INSERT … ON CONFLICT` or RPC) | Strong if single DB | +5–25 ms; adds DB load | Uses existing Supabase | DB slow/down: see §2.1. Need strict key naming + retention/TTL job. |
| **C. Managed API gateway WAF** (e.g. in front of custom domain only) | Per edge POP rules | Low at edge | Extra vendor; may not see all paths if clients hit Supabase directly | Rule drift; false positives block legit users. |
| **D. Deno / platform-native KV** | Varies by product | Low–medium | Coupling to host runtime | Not portable if functions move; verify Supabase Edge compatibility before betting. |

**Recommendation (engineering default):** **Option A (Upstash or equivalent HTTP Redis)** for the first P2 implementation slice: minimal new infra concepts for Edge (HTTP), clear atomic INCR + EXPIRE semantics, easy to test from `tests/edge/`. **Option B** remains a valid second choice if the org wants **no new vendors** and accepts DB latency + capacity planning.

### 2.1 Store-unavailable behavior (must be decided in implementation PR)

| Policy | User impact | Security |
|--------|-------------|----------|
| **Fail-open** (skip limit when store errors) | No extra outages | Brief window of weaker throttling; must fire **high-severity alert**. |
| **Fail-closed** (`503` / `upstream_unavailable`) | Legitimate users blocked if store is hard-down | Stricter abuse posture; risk of self-DoS. |

**Design decision:** Default to **fail-open** with structured `console.error` + **alerting** on store failures, unless compliance requires fail-closed (then document exception). Rationale: auth availability is paramount; in-memory limiter already provides partial cover; missing rate limit is less catastrophic than mass lockout during a Redis blip.

### 2.2 Keying and parity with today’s semantics

- Preserve **dual buckets** per route: `…:ip:<client_ip>` and `…:identity:<normalized_email>` (same windows and approximate limits unless abuse data says otherwise).
- **IP extraction:** Continue to use first `x-forwarded-for` hop; document trust boundary (only safe if edge/runtime strips untrusted `X-Forwarded-For` — verify in deployment).
- **Response contract:** Keep `429` + `code: rate_limited` + `Retry-After` (seconds) aligned with `errorEnvelope` taxonomy.

### 2.3 CAPTCHA / step-up (optional hook)

- If repeated **identity** bucket violations occur from many IPs (credential stuffing pattern), implementation may emit an internal event for **future** CAPTCHA or MFA step-up — **not** required for first merge; document extension point in code comments only when building P2.

## 3. Auth logging — minimization and PII redaction contract

### 3.1 Goals

- Support **security operations** (who hit what, rate of 401/429) without storing **secrets** or unnecessary **PII** in logs.
- Align with route invariants in the hardening spec (no enumeration leakage in **responses**; logs are a separate channel but must not undermine that posture).

### 3.2 Field rules (auth edge handlers: `auth-login`, `auth-signup`, `profiles-me`, shared middleware)

| Data | In production logs |
|------|---------------------|
| Passwords, magic links, refresh tokens, raw `Authorization` | **Never.** |
| Full request JSON body | **Never** (log validation outcome + `requestId` only). |
| Email addresses | **Avoid.** If needed for abuse investigation, log **one-way hash** (e.g. SHA-256 of normalized email + server salt) or **redacted** form (`***@domain.tld`). |
| Supabase `error.message` from auth SDK | **Do not log verbatim** on failed login/signup; log **stable internal code** + `requestId` + http outcome. |
| `user.id` (UUID) after successful auth | **Allowed** for authenticated access logs. |
| IP (for rate limit / abuse) | **Allowed** in structured fields; restrict access to log sinks. |
| `requestId` | **Always** include on error paths for correlation. |

### 3.3 `logApiAccess` evolution (implementation note)

- Today: `console.log` with `userId`, `userRole`, `path`, `status` (`auth-middleware.ts`). That is **acceptable** for paths where `userId` is `'anonymous'`.
- **Future:** Prefer **single JSON line** per event (`{ "ts", "route", "status", "requestId", "userId"|null, "outcome" }`) and route through a sink that supports retention and access control. Refactor **`console.error('Login error:', error)`**-style calls to log **`error` metadata allowlist** only (e.g. `name`, `status` if present), not full objects.

## 4. Observability and abuse-resilience — acceptance criteria (pre-coding checklist)

Implementation tickets **must** demonstrate:

1. **Metrics (or structured log queries)** for `auth-login` / `auth-signup`:
   - Count of `429` by `rate_limited` vs total requests.
   - Count of `401` / `validation_error` (non-enumerating responses unchanged).
2. **Alert (or dashboard threshold)** when:
   - Rate-limit store error rate > **N** / 5 minutes (tunable), or
   - Single IP > **M** `429`s / minute sustained (credential-stuffing signal).
3. **Load / chaos characterization (staging):**
   - Document behavior with **≥2** concurrent function instances hammering the same key — observed limit **at or below** configured ceiling (within agreed tolerance, e.g. +10%).
4. **Runbook snippet:** One paragraph in `docs/security/` or ops wiki: “If Redis/KV unavailable, expect X; mitigations Y.”

## 5. Verification mapping (for future implementation)

- Extend `tests/edge/auth-route-contracts.test.ts` (or adjacent suite) with **contract tests** for `429` + `Retry-After` unchanged.
- Add **integration tests** behind a flag or mock HTTP store (no real vendor in CI required) proving atomicity of increment path.
- Re-run `npm run ci:check-focused`, `npm run test:ci`, and any existing auth middleware tests.

## 6. Traceability

- **Linear:** WIN-39 (design closure).  
- **Implementation:** Split into one or more child issues (e.g. store adapter + auth-login/signup swap + logging refactor); each must link here and to `AUTH_ROUTE_HARDENING_SPEC_2026_03_13.md`.
