# SH Central iiko Session Broker — **NOT DEPLOYED**

The iiko REST API consumes a limited licensed slot for each new session. Cloudflare
Pages isolates currently use different token maps and can independently log in.
This private Cloudflare Worker provides one serialized, durable session per
**verified owner/workspace + exact server/login/password**.

## Guarantees

- The Worker is private (no workers.dev route). Pages accesses it via a **service binding**.
- Each Durable Object serializes data requests; the token is encrypted with AES-256-GCM
  using a secret that is **not committed** to GitHub; the record survives evictions.
- A successful auth token is stored before being used. After a cached-token **401**,
  at most one new login is attempted. A **403** never triggers login.
- An ambiguous login response is **not retried**; a 5-minute persisted cooldown limits
  repeated license allocation. Logout is reserved for disconnect or credential rotation.
- No cross-organization token sharing. Each request uses a verified tenant ID from
  backend authorization, never a caller-provided restaurant selection.
- The upstream license token is never sent to a mobile device or browser.
- `/resto/api/auth`, `/resto/api/logout`, and caller-provided `key` are
  blocked on the regular request path.

## Required production steps

1. Verify actual iiko version and test the supported auth method in a controlled
   environment. Default remains GET (existing behavior), *not* speculative POST.
2. Create secure random secrets: `IIKO_BROKER_SERVICE_SECRET` (>=32 random bytes)
   and `IIKO_BROKER_ENCRYPTION_KEY_B64` (base64 of 32 random bytes).
   Configure both with `wrangler secret put`; never publish or rotate the
   encryption key without a controlled session-drain procedure.
3. Configure `IIKO_ALLOWED_TARGETS` as a comma-separated allowlist of registered iiko hosts and ports (e.g. `restaurant.example:8080`); an empty list rejects all traffic. Do not expose local/cloud metadata endpoints. Deploy Worker `sh-iiko-session-broker` with Durable Object SQLite migration.
   Keep `workers_dev = false` and no public route.
4. Add Pages service binding `IIKO_SESSION_BROKER` -> `sh-iiko-session-broker`;
   set Pages secret `IIKO_BROKER_SERVICE_SECRET` equal to Worker service secret.
5. **Do not bind the Worker until all iiko request entry points are instrumented.**
   A partial cutover still creates license sessions in other Worker isolates.
   `bindIikoBroker()` enables an individual trusted route in a later migration.
6. Scope the allowed iiko host:port per workspace from stored server settings.
   For production apply a *network egress allowlist* or validated registered
   target lookup on the trusted backend before making the binding available.
7. Test: two simultaneous Workers sharing a session, iiko 401, simulated
   authentication timeout, 403/no retries, logout, per-tenant separation, and
   a Worker restart. Count actual active REST_API seats on the iiko Server.
8. Switch traffic gradually behind a feature flag, check licensing and latency,
   then remove the old isolate-local auth path. Never deploy both on the same
   organization without an explicit cutover and logout strategy.

## Threat model / limitations

This broker removes duplicate sessions **only for requests routed through it**.
It cannot recover licenses occupied by old isolates, 3rd-party clients or
older deployments. The shared secret authenticates the private service caller,
not the end user: Pages must continue its existing authentication, tenant
isolation and RBAC checks. Never accept tenant ID or credentials directly
from the mobile client. Cloudflare encryption key loss prevents recovery of
saved tokens and must fail closed. No production deployment has been made.
