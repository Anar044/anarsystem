(function () {
    "use strict";

    const IDENTITY_KEY = "iikoDepartmentIdentity";
    const CONNECTION_KEY = "iikoConnection";
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
        try { return JSON.parse(text); }
        catch { return { success: false, message: text }; }
    }

    function setStatus(text) {
        const element = $("iiko-status");
        if (element) element.textContent = text;
    }

    function renderIdentity(departments, organizations, server, chain) {
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

        html += `<div class="iiko-identity-empty">Режим: <strong>${chain ? "CHAIN — сеть ресторанов" : "RMS — один ресторан"}</strong></div>`;

        if (chain && orgs.length) {
            html += orgs.map(org => `
                <div class="iiko-identity-item">
                    <div class="iiko-identity-name">Торговое предприятие: ${esc(org.name || "Ресторан")}</div>
                    <div class="iiko-identity-id">Department ID: ${esc(org.id)}</div>
                    ${org.code ? `<div class="iiko-identity-id">Код: ${esc(org.code)}</div>` : ""}
                </div>
            `).join("");
        } else if (!chain && orgs.length) {
            html += orgs.map(org => `
                <div class="iiko-identity-item">
                    <div class="iiko-identity-name">Организация: ${esc(org.name || "Организация")}</div>
                    <div class="iiko-identity-id">Organization ID: ${esc(org.id)}</div>
                    ${org.address ? `<div class="iiko-identity-id">${esc(org.address)}</div>` : ""}
                </div>
            `).join("");
        }

        if (deps.length) {
            html += `<div class="iiko-identity-empty" style="margin-top:8px">Подразделения SH Server</div>`;
            html += deps.map(item => `
                <div class="iiko-identity-item">
                    <div class="iiko-identity-name">${esc(item.name || item.code || "Подразделение")}</div>
                    <div class="iiko-identity-id">Department ID: ${esc(item.id)}</div>
                    ${item.parentId ? `<div class="iiko-identity-id">Parent ID: ${esc(item.parentId)}</div>` : ""}
                </div>
            `).join("");
        }

        if (!orgs.length && !deps.length) {
            html += `<div class="iiko-identity-empty">Структура подразделений не получена.</div>`;
        }
        list.innerHTML = html;
    }

    function renderSavedIdentity() {
        try {
            const saved = localStorage.getItem(IDENTITY_KEY);
            const connection = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null");
            if (!saved && !connection) return;
            const data = saved ? JSON.parse(saved) : {};
            const departments = Array.isArray(data.departments) ? data.departments : (Array.isArray(connection?.departments) ? connection.departments : []);
            const organizations = Array.isArray(data.organizations) ? data.organizations : (Array.isArray(connection?.organizations) ? connection.organizations : []);
            renderIdentity(departments, organizations, data.server || connection, connection?.connectionType === "CHAIN" || data.mode === "CHAIN");
            const chain = $("is-chain");
            if (chain) chain.checked = connection?.connectionType === "CHAIN" || data.mode === "CHAIN";
            const hint = $("chain-hint");
            if (hint && chain) hint.classList.toggle("visible", chain.checked);
        } catch (error) { console.warn("Cannot load saved SH identity", error); }
    }

    async function handleIdentityConnection(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const ip = $("iiko-ip")?.value.trim();
        const port = $("iiko-port")?.value.trim();
        const login = $("iiko-login")?.value.trim();
        const password = $("iiko-password")?.value || "";
        const remember = $("remember-iiko")?.checked === true;
        const isChain = $("is-chain")?.checked === true;

        if (!ip || !port || !login || !password) {
            setStatus("🟠 Заполните IP, порт, логин и пароль");
            return;
        }

        const button = $("connect-iiko");
        if (button) button.disabled = true;
        setStatus(isChain ? "🟡 Подключение к SH Server и получение структуры сети..." : "🟡 Подключение к SH Server...");

        const card = $("iiko-identity");
        const list = $("iiko-identity-list");
        if (card && list) {
            card.hidden = false;
            list.innerHTML = `<div class="iiko-identity-empty">${isChain ? "Получаем структуру iikoChain..." : "Получаем Department ID..."}</div>`;
        }

        try {
            const response = await fetch("/api/iiko/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ ip, port, login, password })
            });
            const data = await safeJson(response);
            if (!response.ok || data.success === false) {
                setStatus(`🔴 HTTP ${response.status}`);
                if (list) list.innerHTML = `<div class="iiko-identity-empty">Ошибка подключения: ${esc(data.message || `HTTP ${response.status}`)}</div>`;
                return;
            }

            let departments = Array.isArray(data.departments) ? data.departments : [];
            let organizations = Array.isArray(data.organizations) ? data.organizations : [];
            let chainStructure = null;

            if (isChain) {
                const chainResponse = await fetch("/api/iiko/chain", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ ip, port, login, password })
                });
                chainStructure = await safeJson(chainResponse);
                if (!chainResponse.ok || chainStructure.success === false) {
                    throw new Error(chainStructure.message || `Ошибка получения структуры сети HTTP ${chainResponse.status}`);
                }
                departments = Array.isArray(chainStructure.departments) ? chainStructure.departments : departments;
                organizations = Array.isArray(chainStructure.restaurants) ? chainStructure.restaurants : organizations;
            }

            const organizationId = String(data.organizationId || organizations[0]?.id || departments[0]?.id || "");
            const checkedAt = new Date().toISOString();
            const identity = {
                mode: isChain ? "CHAIN" : "RMS",
                organizationId,
                organizations,
                departmentIds: departments.map(item => item.id),
                departments,
                hierarchy: chainStructure?.hierarchy || [],
                groups: chainStructure?.groups || [],
                pointsOfSale: chainStructure?.pointsOfSale || [],
                restaurantSections: chainStructure?.restaurantSections || [],
                server: { ip, port },
                checkedAt
            };
            localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));

            const connection = {
                ip, port, login, password,
                connectionType: isChain ? "CHAIN" : "RMS",
                isChain,
                organizationId,
                departmentIds: identity.departmentIds,
                departments,
                organizations,
                hierarchy: identity.hierarchy,
                groups: identity.groups,
                pointsOfSale: identity.pointsOfSale,
                restaurantSections: identity.restaurantSections,
                connectedAt: checkedAt
            };

            if (remember) localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
            else localStorage.removeItem(CONNECTION_KEY);

            renderIdentity(departments, organizations, identity.server, isChain);
            setStatus(isChain
                ? `🟢 SH Chain подключён • ресторанов: ${organizations.length}`
                : (organizationId ? `🟢 SH Server подключён • Department ID: ${organizationId}` : "🟢 SH Server подключён"));

            console.info("SH CONNECTION TYPE:", connection.connectionType);
            console.info("SH CHAIN STRUCTURE:", isChain ? chainStructure : null);
        } catch (error) {
            setStatus("🔴 Ошибка соединения");
            if (list) list.innerHTML = `<div class="iiko-identity-empty">${esc(error?.message || error)}</div>`;
            console.warn("SH CONNECTION FAILED:", error);
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
        document.addEventListener("DOMContentLoaded", () => { renderSavedIdentity(); bindIdentityLookup(); });
    } else {
        renderSavedIdentity();
        bindIdentityLookup();
    }
})();
