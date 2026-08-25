(function () {
    "use strict";

    const IDENTITY_KEY = "iikoDepartmentIdentity";

    async function safeJson(response) {
        const text = await response.text();
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch {
            return { success: false, message: text };
        }
    }

    function bindIdentityLookup() {
        const button = document.getElementById("connect-iiko");
        if (!button || button.dataset.identityBound === "1") return;

        button.dataset.identityBound = "1";

        button.addEventListener("click", async () => {
            const ip = document.getElementById("iiko-ip")?.value.trim();
            const port = document.getElementById("iiko-port")?.value.trim();
            const login = document.getElementById("iiko-login")?.value.trim();
            const password = document.getElementById("iiko-password")?.value || "";

            if (!ip || !port || !login || !password) return;

            try {
                const response = await fetch("/api/iiko/connect", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ ip, port, login, password })
                });

                const data = await safeJson(response);

                if (!response.ok || data.success === false) {
                    console.warn(
                        "IIKO IDENTITY ERROR:",
                        data.message || response.status
                    );
                    return;
                }

                localStorage.setItem(
                    IDENTITY_KEY,
                    JSON.stringify({
                        departmentIds: Array.isArray(data.departmentIds)
                            ? data.departmentIds
                            : [],
                        departments: Array.isArray(data.departments)
                            ? data.departments
                            : [],
                        server: { ip, port },
                        checkedAt: new Date().toISOString()
                    })
                );

                console.info(
                    "IIKO DEPARTMENT IDENTITY:",
                    data.departmentIds || []
                );
            } catch (error) {
                console.warn(
                    "IIKO IDENTITY REQUEST FAILED:",
                    error
                );
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindIdentityLookup);
    } else {
        bindIdentityLookup();
    }
})();
