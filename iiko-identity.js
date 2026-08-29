(function () {
    "use strict";

    const IDENTITY_KEY = "iikoDepartmentIdentity";
    const $ = id => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));
    }

    async function safeJson(response) {
        const text = await response.text();
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch {
            return { success: false, message: text };
        }
    }

    function renderIdentity(departments, organizations, server) {
        const card = $("iiko-identity");
        const list = $("iiko-identity-list");

        if (!card || !list) return;

        card.hidden = false;

        const orgs = Array.isArray(organizations) ? organizations : [];

        let html = "";

        if (server?.ip && server?.port) {
            html += `<div class="iiko-identity-empty">Сервер: ${esc(server.ip)}:${esc(server.port)}</div>`;
        }

        if (orgs.length) {
            html += orgs.map(org => `
                <div class="iiko-identity-item">
                    <div class="iiko-identity-name">
                        Организация: ${esc(org.name || "Организация")}
                    </div>
                    <div class="iiko-identity-id" title="Настоящий Organization ID для API">
                        Organization ID: ${esc(org.id)}
                    </div>
                    ${org.address ? `<div class="iiko-identity-id">${esc(org.address)}</div>` : ""}
                </div>
            `).join("");
        } else {
            html += `
                <div class="iiko-identity-empty">
                    Organization ID через /api/1/organizations не получен.
                </div>
            `;
        }

        if (departments.length) {
            html += `
                <div class="iiko-identity-empty" style="margin-top:8px">
                    Подразделения iiko Server
                </div>
            `;
            html += departments.map(item => `
                <div class="iiko-identity-item">
                    <div class="iiko-identity-name">
                        ${esc(item.name || item.code || "Подразделение")}
                    </div>
                    <div class="iiko-identity-id" title="ID подразделения">
                        Department ID: ${esc(item.id)}
                    </div>
                </div>
            `).join("");
        }

        list.innerHTML = html;
    }

    function renderSavedIdentity() {
        try {
            const saved = localStorage.getItem(IDENTITY_KEY);
            if (!saved) return;

            const data = JSON.parse(saved);
            const departments = Array.isArray(data.departments)
                ? data.departments
                : [];
            const organizations = Array.isArray(data.organizations)
                ? data.organizations
                : [];

            renderIdentity(departments, organizations, data.server);
        } catch (error) {
            console.warn("Cannot load saved iiko identity", error);
        }
    }

    function bindIdentityLookup() {
        const button = $("connect-iiko");
        if (!button || button.dataset.identityBound === "1") return;

        button.dataset.identityBound = "1";

        button.addEventListener("click", async () => {
            const ip = $("iiko-ip")?.value.trim();
            const port = $("iiko-port")?.value.trim();
            const login = $("iiko-login")?.value.trim();
            const password = $("iiko-password")?.value || "";

            if (!ip || !port || !login || !password) return;

            const card = $("iiko-identity");
            const list = $("iiko-identity-list");

            if (card && list) {
                card.hidden = false;
                list.innerHTML = `<div class="iiko-identity-empty">Получаем Organization ID и подразделения iiko Server...</div>`;
            }

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
                    if (list) {
                        list.innerHTML = `
                            <div class="iiko-identity-empty">
                                Не удалось получить идентификаторы: ${esc(data.message || response.status)}
                            </div>
                        `;
                    }
                    console.warn("IIKO IDENTITY ERROR:", data.message || response.status);
                    return;
                }

                const departments = Array.isArray(data.departments)
                    ? data.departments
                    : [];
                const organizations = Array.isArray(data.organizations)
                    ? data.organizations
                    : [];

                const identity = {
                    organizationId: String(data.organizationId || organizations[0]?.id || ""),
                    organizations,
                    departmentIds: Array.isArray(data.departmentIds)
                        ? data.departmentIds
                        : departments.map(item => item.id),
                    departments,
                    server: { ip, port },
                    checkedAt: new Date().toISOString()
                };

                localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

                renderIdentity(departments, organizations, identity.server);

                console.info("IIKO ORGANIZATION ID:", identity.organizationId);
                console.info("IIKO DEPARTMENT IDS:", identity.departmentIds);
            } catch (error) {
                if (list) {
                    list.innerHTML = `
                        <div class="iiko-identity-empty">
                            Ошибка получения идентификаторов iiko Server.
                        </div>
                    `;
                }
                console.warn("IIKO IDENTITY REQUEST FAILED:", error);
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            renderSavedIdentity();
            bindIdentityLookup();
        });
    } else {
        renderSavedIdentity();
        bindIdentityLookup();
    }
})();
