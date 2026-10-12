# Smart Horeca: stable navigation architecture (opt-in)

## Root cause
The production app is a multi-page application with dozens of protected HTML documents. Each reinitializes `app-shell.js`; `site-access.js` asynchronously filters nav links; global CSS hides unchecked links. During cross-document navigation the sidebar is destroyed and rebuilt. A separate `.reports-nav-group` briefly remains visible while other groups are hidden. Shared nav, branding and mobile scripts load with inconsistent querystring versions between pages, so the transient state can vary.

Cross-document View Transitions only animate snapshots; caching old link visibility merely hides some symptoms. Introducing Turbo Drive directly would reuse the JS execution environment despite page-specific global scripts; every existing module would first need lifecycle cleanup.

## Chosen architecture
One authenticated first-party parent document `/persistent-workspace.html` owns the sidebar, permission filtering, collapsed groups and scroll position. An opt-in route controller `persistent-workspace.js` sends only the **right content area** to same-origin first-party HTML documents in a buffered iframe. The old document stays visible until the new child proves it has an authorized session. No API data is cached by the parent, and child endpoints continue to enforce authorization. All nav routes use the common access-checked sidebar's `data-permission`; procurement and internal order views keep their explicit per-view role rules. Every child running `app-shell.js` hides its *duplicate* sidebar only when embedded by the tagged parent.

This retains hundreds of existing scripts and handlers without forcing an unsafe same-document lifecycle refactor. It is a migration adapter, not a claim that iframes are a perfect final architecture. Long term, convert new modules to a real nested-layout router (for example React Router) and a single lifecycle-managed frontend bundle.

## Scope and test
1. This route is **opt-in**. Do not test ordinary `/procurement.html`, `/dashboard.html`, etc. expecting a persistent sidebar.
2. Enter via `/persistent-workspace.html`, then click the authorized left menu links. Nonmenu URLs, external URLs, auth links and hidden/unchecked entries are blocked by the persistent controller.
3. Check Dashboard, AI Assistant, cash, external procurement (all views), internal orders (all views), warehouse, reports, finance and HR.
4. Expand groups, scroll, navigate back/forward, open documents, switch restaurants, try a restricted-role employee, and test logout/expired session.
5. Use an active workspace membership on the *same origin*. Preview DB access may differ from production; `NO_MEMBERSHIP` means no real-user preview acceptance test, not an invitation to bypass authorization.

## Constraints and rollback
- Current `main` keeps its old navigation untouched.
- No changes to purchasing, inventory, payroll, accounting or POS business actions.
- Browser nested-history handling and same-origin iframe behaviour need actual Chrome end-to-end acceptance. Opening a section that navigates itself can modify iframe history independently, so test Back/Forward in real workflows.
- A frame is deliberately not sandboxed because existing trusted scripts expect the normal first-party environment. Never load arbitrary external content in the pilot frame.
- If an origin fails membership authentication, do not attempt to fix UI by automatically granting membership.
- Before enabling by default, run e2e tests for permissions, document drafts, embedded modals, uploads/exports, direct links and session logout. Only then consider merging and enabling via a feature flag.
