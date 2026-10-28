# Configurable POS Backend for Smart Horeca

Server-side configuration only (never browser JS or mobile):

- SH_BACKEND_API_URL — the trusted backend origin, e.g. http://127.0.0.1:3000 when the API runs on the same host. Defaults to the current legacy VPS origin for compatibility.
- SH_BACKEND_PROXY_TOKEN — random private shared secret matching the strict-mode backend; sent only in X-SH-Backend-Token to the backend.

Updated proxy endpoints: /api/plugin/data, request, order-history, status, and the plugin-ingest/heartbeat live registry check.

Before enabling strict backend auth, deploy API proxy with token configured and update the iikoFront plugin client to send its per-plugin Socket.IO credential. Keep backend port private; do not enable strict mode on the live VPS without staged testing. End-user workspace and role authorization are separate controls.
