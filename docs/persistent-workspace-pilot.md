# Smart Horeca: real-page persistent sidebar pilot

This is an **opt-in prototype**, not the default application navigation.
Use `/persistent-workspace.html` on the same deployment origin.

## Enabled real modules
- Dashboard
- External procurement: catalog, requests, approvals, RFQ, suppliers, orders, receiving, analytics, norms and settings
- Internal orders: my, incoming, preparing, shipments, receiving, all and settings

The parent document owns the left sidebar. Each module remains its own protected HTML document within a **same-origin first-party iframe**. All original module JavaScript, independent Supabase session checks and server-side RBAC remain active. Existing nonpilot menu items still navigate normally.

The parent allows only these exact module paths and applies view-level permission checks. On a refused or expired child session it does not show unverified content. Only if the iframe element has `data-sh-persistent-workspace="1"` do the three existing page heads mark themselves as embedded, which suppresses their duplicated menus.

## How to test
1. Sign in with an active workspace membership **on the preview deployment origin**.
2. Open `/persistent-workspace.html`. If the preview environment returns `NO_MEMBERSHIP`, **do not recreate accounts or bypass access**; the preview D1 workspace/member data must be configured separately.
3. Open Dashboard, RFQ, and Internal Orders from the same left sidebar.
4. Expand multiple groups and scroll the left menu. Only the right pane should reload.
5. Test procurement views including PO and receiving, internal order forms and Back/Forward.
6. Test roles with restricted access, including procurement-only and internal-order-only roles.
7. Test logout, session expiry and switching organization.

## Explicit non-goals / limitations
- No rollout to all modules until real-page browser tests pass.
- Full same-origin child documents still initialize their own authenticated services. The browser does not reuse their JS state across document loads.
- An internal-orders URL changed by history.replaceState is observed in the parent without any extra API calls.
- The iframe is intentionally not sandboxed because these first-party applications depend on their existing scripts and app APIs; revisit during production review.
- This pilot has **not** been merged into main and does not modify document posting, stock movements, accounting or HR.
