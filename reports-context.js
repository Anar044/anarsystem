(function () {
    "use strict";

    const CONNECTION_KEY = "iikoConnection";
    const IDENTITY_KEY = "iikoDepartmentIdentity";
    const DEPARTMENTS_COOKIE = "sh_reports_departments";
    let ready = null;
    let cachedState = null;

    function writeSafeCompatibilityState(state) {
        const connection = state?.connection && typeof state.connection === "object"
            ? { ...state.connection }
            : null;
        const identity = state?.identity && typeof state.identity === "object"
            ? state.identity
            : null;

        // Temporary compatibility for reports.js only. /api/iiko/state returns
        // the server-side marker instead of the real password, so no secret is
        // written to browser storage.
        try {
            if (connection) localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
            else localStorage.removeItem(CONNECTION_KEY);

            if (identity) localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
            else localStorage.removeItem(IDENTITY_KEY);
        } catch (error) {
            console.warn("[reports-context] cannot write safe compatibility state", error);
        }
    }

    function writeDepartmentScope(ids) {
        const values = [...new Set((ids || []).map(String).map(x => x.trim()).filter(Boolean))];
        const encoded = encodeURIComponent(values.join(","));
        const maxAge = values.length ? 86400 : 0;
        document.cookie = `${DEPARTMENTS_COOKIE}=${encoded}; Path=/api/iiko; SameSite=Lax; Max-Age=${maxAge}`;
        return values;
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

            const binding = window.SH_IikoContext?.getBinding
                ? await window.SH_IikoContext.getBinding(force)
                : null;
            writeDepartmentScope(binding?.departmentIds || []);

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
        writeDepartmentScope([]);
        cachedState = null;
        ready = null;
    }

    window.SH_ReportsContext = {
        prepare,
        clear: clearCompatibilityState,
        getCached: () => cachedState
    };
})();
