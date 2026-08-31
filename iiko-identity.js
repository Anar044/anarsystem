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

    function setStatus(text) {
        const element = $("iiko-status");
        if (element) element.textContent = text;
    }

    function renderIdentity(departments, organizations, server) {
        const card = $("iiko-identity");
        const list = $("iiko-identity-list");

        if (!card || !list) return;

        card.hidden = false;

        const orgs = Array.isArray(organizations) ? organizations : [];
        const deps = Array.isArray(departments) ? departments : [];

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
        }

        if (deps.length) {
            html += `
                <div class="iiko-identity-empty" style="margin-top:8px">
                    Подразделения iiko Server
                </div>
            `;
            html += deps.map(item => `
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

        if (!orgs.length && !deps.length) {
            html += `
                <div class="iiko-identity-empty">
                    Идентификатор iiko Server не получен.
                </div>
            `;
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

    async function handleIdentityConnection(event) {
        // This handler is intentionally in CAPTURE phase.
        // settings.html also loads reports.js for OLAP compatibility, but
        // reports.js must not run its old connection handler on this page.
        event.preventDefault();
        event.stopImmediatePropagation();

        const ip = $("iiko-ip")?.value.trim();
        const port = $("iiko-port")?.value.trim();
        const login = $("iiko-login")?.value.trim();
        const password = $("iiko-password")?.value || "";
        const remember = $("remember-iiko")?.checked === true;

        if (!ip || !port || !login || !password) {
            setStatus("🟠 Заполните IP, порт, логин и пароль");
            return;
        }

        const button = $("connect-iiko");
        if (button) button.disabled = true;
        setStatus("🟡 Подключение к локальному iiko Server...");

        const card = $("iiko-identity");
        const list = $("iiko-identity-list");

        if (card && list) {
            card.hidden = false;
            list.innerHTML = `<div class="iiko-identity-empty">Получаем Department ID из локального iiko Server...</div>`;
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
                setStatus(`🔴 HTTP ${response.status}`);
                if (list) {
                    list.innerHTML = `
                        <div class="iiko-identity-empty">
                            Ошибка подключения: ${esc(data.message || `HTTP ${response.status}`)}
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

            const organizationId = String(
                data.organizationId ||
                organizations[0]?.id ||
                departments[0]?.id ||
                ""
            );

            const identity = {
                organizationId,
                organizations,
                departmentIds: Array.isArray(data.departmentIds)
                    ? data.departmentIds
                    : departments.map(item => item.id),
                departments,
                server: { ip, port },
                checkedAt: new Date().toISOString()
            };

            localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

            const connection = {
                ip,
                port,
                login,
                password,
                organizationId,
                departmentIds: identity.departmentIds,
                departments,
                organizations,
                connectedAt: identity.checkedAt
            };

            if (remember) {
                localStorage.setItem("iikoConnection", JSON.stringify(connection));
            } else {
                localStorage.removeItem("iikoConnection");
            }

            renderIdentity(departments, organizations, identity.server);
            setStatus(
                organizationId
                    ? `🟢 iiko Server подключён • Department ID: ${organizationId}`
                    : "🟢 iiko Server подключён"
            );

            console.info("IIKO ORGANIZATION ID:", organizationId);
            console.info("IIKO DEPARTMENT IDS:", identity.departmentIds);
        } catch (error) {
            setStatus("🔴 Ошибка соединения");
            if (list) {
                list.innerHTML = `
                    <div class="iiko-identity-empty">
                        Ошибка соединения с локальным iiko Server: ${esc(error?.message || error)}
                    </div>
                `;
            }
            console.warn("IIKO IDENTITY REQUEST FAILED:", error);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function bindIdentityLookup() {
        const button = $("connect-iiko");
        if (!button || button.dataset.identityBound === "1") return;

        button.dataset.identityBound = "1";
        button.addEventListener("click", handleIdentityConnection, true);
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
