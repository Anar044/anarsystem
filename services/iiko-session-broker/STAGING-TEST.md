# SH test iiko Server — staging only (NOT deployed)

Test origin: `http://s01.smarthoreca.az:9132`. The screenshots from the
test server show two active `REST_API(2000)` connections at the observation
time, **not** proof that two seats are licensed in total.

## Required gate before live test

- Keep the production Pages service `smarthoreca.pages.dev` unchanged.
- Check Cloudflare DNS for `s01.smarthoreca.az`: direct/grey-cloud ("DNS
  only") routing is required for arbitrary port **9132** through Worker fetch.
  Cloudflare orange-cloud HTTP proxy only supports listed ports, not 9132.
- Confirm origin is reachable from Cloudflare Worker outbound HTTP, then
  test the read-only `/resto/api/corporation/departments` endpoint.
- Never post passwords, session tokens, API keys or `wrangler secret`
  values to screenshots, chat or GitHub.
- Do NOT run an `/auth` request until there is a spare test REST_API seat,
  or an existing test-only session was safely logged out by its owner.

## Dedicated Worker

The staged Worker uses `wrangler.staging.toml`:
`sh-iiko-session-broker-test`, no public URL, its own Durable Object
namespace, a single allowed host:port and strict sequential mode.

Set `IIKO_BROKER_SERVICE_SECRET` to a unique random secret in the **test
Worker** and (identically) in **Pages Preview** only.
Set `IIKO_BROKER_ENCRYPTION_KEY_B64` to an independent base64-encoded
32-byte cryptographically secure random key in the **test Worker** only.
Do not reuse production secrets and never commit their values.

From `services/iiko-session-broker`:
```powershell
npx wrangler deploy --config wrangler.staging.toml
npx wrangler secret put IIKO_BROKER_SERVICE_SECRET --config wrangler.staging.toml
npx wrangler secret put IIKO_BROKER_ENCRYPTION_KEY_B64 --config wrangler.staging.toml
```
For first deployment, secret order may be swapped; **the worker cannot
serve requests until secrets are configured**. Deploy only after the
user has verified account/project selection in Wrangler.

## Pages preview only

Use the GitHub PR #150 preview build in Cloudflare Pages
`smarthoreca` (confirm Preview uses code from PR branch). The test
Pages preview must have its **own** authentication/tenant-isolated test
workspace connected to `s01.smarthoreca.az:9132`, and must not receive
production restaurant data during tests.

- Pages Preview binding variable: `IIKO_SESSION_BROKER`
- Binding type: Service / Worker `sh-iiko-session-broker-test`
- Pages Preview secret: `IIKO_BROKER_SERVICE_SECRET` (same as test Worker)
- Never install either binding or secret into **Production** environment.
- Redeploy Preview after adding the binding.

## Experiment and acceptance criteria

1. Record `connections.jsp` active REST_API rows and exact observation
   timestamp before test. These are active sessions, not configured
   license entitlement totals.
2. Make exactly **one** authorized read-only dashboard/departments query
   on Preview. Check no 401/403, and one new session at most.
3. Repeat the same report 5 times, then do 10 concurrent *read-only* queries.
   Count REST_API rows again. Expected: no increase in new sessions for the
   same workspace/credentials when token remains valid.
4. Measure response time and `x-sh-broker-wait-ms`/
   `x-sh-broker-upstream-ms` for limits `1`, `3` and `5`,
   gradually, **only if the iiko Server accepts concurrent requests**.
5. Test 401 stale token (once), no new login on 403, server interruption,
   Worker restart and a workspace change. No unintended write requests.
6. Validate CHAIN department visibility and prohibit foreign workspace/
   restaurant IDs. Do not test invoice **posting**, shipment or payroll
   mutations until a separate data rollback plan is ready.
7. After testing, stop creating new requests, log out the brokered test
   session deliberately, and check that the licensed connection is released.

## Rollback

Remove `IIKO_SESSION_BROKER` **Preview** binding and redeploy the Preview
build; leave Production untouched. The broker must never retry directly
if its service binding has failed. Do not recycle the test iiko Server or
delete live sessions solely to clear error 403 without an audit.

This procedure is a controlled checklist, not proof of deployment or
connectivity. All changes to Cloudflare require separate user action.

## Preview service-binding activation

After configuring `IIKO_SESSION_BROKER` and `IIKO_BROKER_SERVICE_SECRET` in the **Preview** environment of Cloudflare Pages `smarthoreca`, deploy a fresh preview commit from this branch. The binding only takes effect on the new preview deployment. Never select `Production` for these settings. Read-only smoke-test first because Preview shares the D1 and R2 resources with Production in the current project configuration.
