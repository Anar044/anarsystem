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

    function renderIdentity(departments, server) {
        const card = $("iiko-identity");
        const list = $("iiko-identity-list");

        if (!card || !list) return;

        card.hidden = false;

        if (!departments.length) {
            list.innerHTML = `
                <div class="iiko-identity-empty">
                    iiko Server подключён, но подразделения типа DEPARTMENT не найдены.
                </div>
            `;
            return;
        }

        list.innerHTML = departments.map(item => `
            <div class="iiko-identity-item">
                <div class="iiko-identity-name">
                    ${esc(item.name || item.code || "Подразделение")}
                </div>
                <div class="iiko-identity-id" title="ID подразделения">
                    ${esc(item.id)}
                </div>
            </div>
        `).join("");

        if (server?.ip && server?.port) {
            list.insertAdjacentHTML(
                "afterbegin",
                `<div class="iiko-identity-empty">Сервер: ${esc(server.ip)}:${esc(server.port)}</div>`
            );
        }
    }

    function renderSavedIdentity() {
        try {
            const saved = localStorage.getItem(IDENTITY_KEY);
            if (!saved) return;

            const data = JSON.parse(saved);
            const departments = Array.isArray(data.departments)
                ? data.departments
                : [];

            renderIdentity(departments, data.server);
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
                list.innerHTML = `<div class="iiko-identity-empty">Получаем идентификатор iiko Server...</div>`;
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
                                Не удалось получить идентификатор: ${esc(data.message || response.status)}
                            </div>
                        `;
                    }

                    console.warn(
                        "IIKO IDENTITY ERROR:",
                        data.message || response.status
                    );
                    return;
                }

                const departments = Array.isArray(data.departments)
                    ? data.departments
                    : [];

                const identity = {
                    departmentIds: Array.isArray(data.departmentIds)
                        ? data.departmentIds
                        : departments.map(item => item.id),
                    departments,
                    server: { ip, port },
                    checkedAt: new Date().toISOString()
                };

                localStorage.setItem(
                    IDENTITY_KEY,
                    JSON.stringify(identity)
                );

                renderIdentity(departments, identity.server);

                console.info(
                    "IIKO DEPARTMENT IDENTITY:",
                    identity.departmentIds
                );
            } catch (error) {
                if (list) {
                    list.innerHTML = `
                        <div class="iiko-identity-empty">
                            Ошибка получения идентификатора iiko Server.
                        </div>
                    `;
                }

                console.warn(
                    "IIKO IDENTITY REQUEST FAILED:",
                    error
                );
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
