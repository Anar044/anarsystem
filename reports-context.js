(function () {
    "use strict";

    const CONNECTION_KEY = "iikoConnection";
    const IDENTITY_KEY = "iikoDepartmentIdentity";
    let ready = null;
    let cachedState = null;

    function writeSafeCompatibilityState(state) {
        const connection = state?.connection && typeof state.connection === "object"
            ? { ...state.connection }
            : null;
        const identity = state?.identity && typeof state.identity === "object"
            ? state.identity
            : null;

        // reports.js still reads the legacy key during this transition.
        // /api/iiko/state already returns only the server-side password marker,
        // never the real iiko password, so this browser copy contains no secret.
        try {
            if (connection) localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
            else localStorage.removeItem(CONNECTION_KEY);

            if (identity) localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
            else localStorage.removeItem(IDENTITY_KEY);
        } catch (error) {
            console.warn("[reports-context] cannot write safe compatibility state", error);
        }
    }

    async function prepare(force = false) {
        if (!force && ready) return ready;

        ready = (async () => {
            if (!window.SH_IikoContext?.get) {
                throw new Error("Единый iiko context не готов");
            }

            const state = await window.SH_IikoContext.get(force);
            cachedState = state || null;
            writeSafeCompatibilityState(cachedState);
            return cachedState;
        })().catch(error => {
            ready = null;
            if (force) cachedState = null;
            throw error;
        });

        return ready;
    }

    function clearCompatibilityState() {
        try {
            localStorage.removeItem(CONNECTION_KEY);
            localStorage.removeItem(IDENTITY_KEY);
        } catch (_) {}
        cachedState = null;
        ready = null;
    }

    window.SH_ReportsContext = {
        prepare,
        clear: clearCompatibilityState,
        getCached: () => cachedState
    };
})();
