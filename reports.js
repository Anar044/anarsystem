// ============================================================
// ANAR SYSTEM — REPORTS + IIKO OLAP CONSTRUCTOR
// reports.js
// ============================================================

(function () {
    "use strict";

    // ============================================================
    // ELEMENTS
    // ============================================================

    const connectButton = document.getElementById("connect-iiko");
    const statusElement = document.getElementById("iiko-status");
    const salesCard = document.getElementById("sales-card");
    const loadSalesButton = document.getElementById("load-sales");
    const salesResult = document.getElementById("sales-result");
    const rememberIiko = document.getElementById("remember-iiko");
    const clearIikoData = document.getElementById("clear-iiko-data");

    // ============================================================
    // IIKO CONNECTION
    // ============================================================

    let iikoConnection = null;

    const IIKO_STORAGE_KEY = "iikoConnection";

    // ============================================================
    // OLAP STATE
    // ============================================================

    let olapFields = [];

    let olapRows = [];
    let olapColumns = [];
    let olapMeasures = [];
    let olapFilters = [];

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function safeJson(response) {
        const text = await response.text();

        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch (error) {
            return {
                success: false,
                message: text.slice(0, 3000),
                rawText: text
            };
        }
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function todayString() {
        const date = new Date();

        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");

        return `${yyyy}-${mm}-${dd}`;
    }

    function formatDate(value) {
        if (!value) return "";

        const stringValue = String(value).slice(0, 10);

        const parts = stringValue.split("-");

        if (parts.length !== 3) {
            return String(value);
        }

        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }

    function formatNumber(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return escapeHtml(value);
        }

        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(number);
    }

    function formatMoney(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return "0,00";
        }

        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(number);
    }

    // ============================================================
    // LOAD SAVED IIKO DATA
    // ============================================================

    function loadSavedIikoData() {
        try {
            const saved = localStorage.getItem(IIKO_STORAGE_KEY);

            if (!saved) {
                return;
            }

            const data = JSON.parse(saved);

            const ip = getElement("iiko-ip");
            const port = getElement("iiko-port");
            const login = getElement("iiko-login");
            const password = getElement("iiko-password");

            if (ip) {
                ip.value = data.ip || "";
            }

            if (port) {
                port.value = data.port || "";
            }

            if (login) {
                login.value = data.login || "";
            }

            if (password) {
                password.value = data.password || "";
            }

            if (rememberIiko) {
                rememberIiko.checked = true;
            }

        } catch (error) {
            console.error(
                "Ошибка загрузки данных iiko:",
                error
            );

            localStorage.removeItem(
                IIKO_STORAGE_KEY
            );
        }
    }

    // ============================================================
    // SAVE IIKO DATA
    // ============================================================

    function saveIikoData() {
        const ip = getElement("iiko-ip");
        const port = getElement("iiko-port");
        const login = getElement("iiko-login");
        const password = getElement("iiko-password");

        const data = {
            ip: ip ? ip.value.trim() : "",
            port: port ? port.value.trim() : "",
            login: login ? login.value.trim() : "",
            password: password ? password.value : ""
        };

        localStorage.setItem(
            IIKO_STORAGE_KEY,
            JSON.stringify(data)
        );
    }

    // ============================================================
    // CLEAR IIKO DATA
    // ============================================================

    if (clearIikoData) {

        clearIikoData.addEventListener(
            "click",
            function () {

                localStorage.removeItem(
                    IIKO_STORAGE_KEY
                );

                const ip = getElement("iiko-ip");
                const port = getElement("iiko-port");
                const login = getElement("iiko-login");
                const password = getElement("iiko-password");

                if (ip) ip.value = "";
                if (port) port.value = "";
                if (login) login.value = "";
                if (password) password.value = "";

                if (rememberIiko) {
                    rememberIiko.checked = false;
                }

                iikoConnection = null;

                if (salesCard) {
                    salesCard.style.display = "none";
                }

                if (statusElement) {
                    statusElement.textContent =
                        "⚪ Данные iiko удалены";
                }

                if (salesResult) {
                    salesResult.innerHTML = "";
                }

                const builder =
                    getElement("olap-builder");

                if (builder) {
                    builder.remove();
                }

                olapFields = [];
                olapRows = [];
                olapColumns = [];
                olapMeasures = [];
                olapFilters = [];
            }
        );
    }

    // ============================================================
    // CONNECT IIKO
    // ============================================================

    if (connectButton) {

        connectButton.addEventListener(
            "click",
            async function () {

                const ipElement =
                    getElement("iiko-ip");

                const portElement =
                    getElement("iiko-port");

                const loginElement =
                    getElement("iiko-login");

                const passwordElement =
                    getElement("iiko-password");

                const ip =
                    ipElement
                        ? ipElement.value.trim()
                        : "";

                const port =
                    portElement
                        ? portElement.value.trim()
                        : "";

                const login =
                    loginElement
                        ? loginElement.value.trim()
                        : "";

                const password =
                    passwordElement
                        ? passwordElement.value
                        : "";

                if (
                    !ip ||
                    !port ||
                    !login ||
                    !password
                ) {

                    if (statusElement) {
                        statusElement.textContent =
                            "⚠️ Заполните IP, порт, логин и пароль";
                    }

                    return;
                }

                connectButton.disabled = true;

                connectButton.textContent =
                    "Подключение...";

                if (statusElement) {
                    statusElement.textContent =
                        "⏳ Подключаемся к iiko Server...";
                }

                try {

                    const response =
                        await fetch(
                            "/api/iiko/connect",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({
                                        ip,
                                        port,
                                        login,
                                        password
                                    })
                            }
                        );

                    const data =
                        await safeJson(
                            response
                        );

                    console.log(
                        "IIKO CONNECT:",
                        data
                    );

                    if (
                        !response.ok ||
                        data.success === false
                    ) {

                        throw new Error(
                            data.message ||
                            "Ошибка подключения к iiko"
                        );
                    }

                    if (
                        rememberIiko &&
                        rememberIiko.checked
                    ) {

                        saveIikoData();

                    } else {

                        localStorage.removeItem(
                            IIKO_STORAGE_KEY
                        );
                    }

                    iikoConnection = {
                        ip,
                        port,
                        login,
                        password
                    };

                    if (statusElement) {

                        statusElement.textContent =
                            "🟢 iiko Server подключён";
                    }

                    if (salesCard) {
                        salesCard.style.display =
                            "block";
                    }

                    createOlapBuilder();

                    await loadOlapFields();

                } catch (error) {

                    console.error(
                        "Ошибка подключения:",
                        error
                    );

                    if (statusElement) {

                        statusElement.textContent =
                            "🔴 " +
                            error.message;
                    }

                } finally {

                    connectButton.disabled =
                        false;

                    connectButton.textContent =
                        "Подключиться";
                }
            }
        );
    }

    // ============================================================
    // CREATE OLAP BUILDER
    // ============================================================

    function createOlapBuilder() {

        if (getElement("olap-builder")) {
            return;
        }

        const container =
            document.querySelector(
                ".reports-container"
            );

        if (!container) {

            console.error(
                "Не найден .reports-container"
            );

            return;
        }

        const builder =
            document.createElement("section");

        builder.id =
            "olap-builder";

        builder.innerHTML = `

<style>

#olap-builder {
    margin-top: 24px;
    background: #ffffff;
    border: 1px solid #dfe5ec;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(15,23,42,.06);
    color: #172033;
}

#olap-builder *,
#olap-builder *::before,
#olap-builder *::after {
    box-sizing: border-box;
}

#olap-builder .olap-top {
    padding: 20px 24px;
    border-bottom: 1px solid #e8edf2;
    background: #ffffff;
}

#olap-builder .olap-title-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
}

#olap-builder .olap-title {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
}

#olap-builder .olap-subtitle {
    margin-top: 5px;
    color: #758195;
    font-size: 13px;
}

#olap-builder .olap-status {
    padding: 10px 24px;
    background: #f7f9fb;
    border-bottom: 1px solid #e8edf2;
    font-size: 13px;
    color: #64748b;
}

#olap-builder .olap-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    overflow-x: auto;
    border-bottom: 1px solid #e8edf2;
    background: #fafbfc;
}

#olap-builder .olap-tab {
    border: 1px solid #dce3ea;
    background: #ffffff;
    border-radius: 7px;
    padding: 7px 12px;
    white-space: nowrap;
    cursor: pointer;
    font-size: 12px;
    color: #405066;
}

#olap-builder .olap-tab:hover {
    background: #f2f5f8;
}

#olap-builder .olap-content {
    display: grid;
    grid-template-columns: 330px 1fr;
    min-height: 570px;
}

#olap-builder .olap-left {
    background: #f8fafc;
    border-right: 1px solid #e8edf2;
    padding: 18px;
}

#olap-builder .olap-right {
    padding: 18px;
    min-width: 0;
}

#olap-builder .olap-section-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 9px;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    color: #46566d;
}

#olap-builder .olap-count {
    font-size: 11px;
    color: #9aa5b4;
}

#olap-builder .olap-search {
    width: 100%;
    height: 40px;
    border: 1px solid #d8e0e8;
    border-radius: 8px;
    background: #fff;
    padding: 0 12px;
    outline: none;
    font-size: 13px;
}

#olap-builder .olap-search:focus {
    border-color: #8a99aa;
}

#olap-builder .olap-fields {
    margin-top: 10px;
    max-height: 500px;
    overflow-y: auto;
    padding-right: 4px;
}

#olap-builder .olap-field {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 47px;
    margin-bottom: 5px;
    padding: 6px 8px;
    border: 1px solid #e1e6ec;
    border-radius: 7px;
    background: #ffffff;
    cursor: grab;
    text-align: left;
    color: #172033;
}

#olap-builder .olap-field:hover {
    background: #f4f7fa;
    border-color: #cbd5df;
}

#olap-builder .olap-field:active {
    cursor: grabbing;
}

#olap-builder .olap-icon {
    width: 27px;
    height: 27px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: #eef2f6;
    flex: 0 0 27px;
}

#olap-builder .olap-field-name {
    min-width: 0;
    flex: 1;
}

#olap-builder .olap-field-name strong {
    display: block;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-field-name small {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    color: #8b98a8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-plus {
    color: #9aa5b4;
}

#olap-builder .olap-zones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

#olap-builder .olap-zone-block {
    min-width: 0;
}

#olap-builder .olap-zone-title {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 7px;
    font-size: 12px;
    font-weight: 800;
    color: #43536a;
}

#olap-builder .olap-zone-number {
    margin-left: auto;
    color: #a0aab7;
    font-size: 10px;
}

#olap-builder .olap-dropzone {
    min-height: 108px;
    padding: 7px;
    border: 1px dashed #c8d1dc;
    border-radius: 9px;
    background: #fafbfd;
}

#olap-builder .olap-dropzone.over {
    border-color: #66778b;
    background: #f0f3f6;
}

#olap-builder .olap-dropzone.has-items {
    border-style: solid;
}

#olap-builder .olap-empty {
    min-height: 90px;
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 10px;
    color: #9aa5b4;
    font-size: 11px;
}

#olap-builder .olap-chip {
    min-height: 43px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 7px;
    margin-bottom: 5px;
    background: #ffffff;
    border: 1px solid #dfe5eb;
    border-radius: 7px;
    cursor: grab;
}

#olap-builder .olap-chip:last-child {
    margin-bottom: 0;
}

#olap-builder .olap-chip-text {
    flex: 1;
    min-width: 0;
}

#olap-builder .olap-chip-text strong {
    display: block;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-chip-text small {
    display: block;
    margin-top: 2px;
    color: #929dac;
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-remove {
    width: 25px;
    height: 25px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #9aa5b4;
    cursor: pointer;
    font-size: 17px;
}

#olap-builder .olap-remove:hover {
    background: #fff0f0;
    color: #d22d2d;
}

#olap-builder .olap-aggregation {
    height: 28px;
    border: 1px solid #d8e0e8;
    border-radius: 6px;
    background: #f8fafc;
    font-size: 10px;
}

#olap-builder .olap-period {
    margin-top: 14px;
    padding: 13px;
    border: 1px solid #e2e7ed;
    border-radius: 9px;
    background: #fafbfd;
}

#olap-builder .olap-period-title {
    font-size: 12px;
    font-weight: 800;
    margin-bottom: 8px;
}

#olap-builder .olap-period-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

#olap-builder .olap-period label {
    font-size: 10px;
    font-weight: 700;
    color: #6d7b8d;
}

#olap-builder .olap-period input {
    display: block;
    width: 100%;
    height: 36px;
    margin-top: 4px;
    border: 1px solid #d8e0e8;
    border-radius: 6px;
    padding: 0 8px;
    background: #fff;
}

#olap-builder .olap-actions {
    display: flex;
    gap: 8px;
    margin-top: 13px;
}

#olap-builder .olap-run {
    flex: 1;
    min-height: 43px;
    border: 0;
    border-radius: 7px;
    background: #20252b;
    color: white;
    font-weight: 700;
    cursor: pointer;
}

#olap-builder .olap-run:hover {
    background: #11161b;
}

#olap-builder .olap-run:disabled {
    opacity: .6;
    cursor: wait;
}

#olap-builder .olap-clear {
    min-height: 43px;
    padding: 0 14px;
    border: 1px solid #d8e0e8;
    border-radius: 7px;
    background: #fff;
    color: #58677a;
    cursor: pointer;
}

#olap-builder .olap-quick {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
}

#olap-builder .olap-quick button {
    border: 1px solid #d8e0e8;
    border-radius: 6px;
    background: #fff;
    padding: 6px 9px;
    cursor: pointer;
    font-size: 10px;
    color: #58677a;
}

#olap-builder .olap-result {
    border-top: 1px solid #e8edf2;
    background: #ffffff;
    padding: 18px 20px;
    overflow-x: auto;
}

#olap-builder .olap-result h3 {
    margin: 0 0 12px;
    font-size: 15px;
}

#olap-builder .olap-result-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

#olap-builder .olap-result-table th {
    padding: 9px 10px;
    text-align: left;
    background: #f1f4f7;
    border: 1px solid #dce3e9;
    font-weight: 800;
    white-space: nowrap;
}

#olap-builder .olap-result-table td {
    padding: 8px 10px;
    border: 1px solid #e1e6eb;
    white-space: nowrap;
}

#olap-builder .olap-result-table tbody tr:hover {
    background: #fafbfd;
}

#olap-builder .olap-error {
    padding: 12px;
    border: 1px solid #f0b6b6;
    border-radius: 7px;
    background: #fff5f5;
    color: #bd2020;
    font-size: 12px;
}

#olap-builder .olap-loading {
    padding: 20px;
    text-align: center;
    color: #718096;
}

#olap-builder .olap-debug {
    margin-top: 12px;
    padding: 10px;
    border: 1px solid #e0e5ea;
    border-radius: 7px;
    background: #f7f9fb;
    color: #68778a;
    font-size: 10px;
}

@media (max-width: 950px) {

    #olap-builder .olap-content {
        grid-template-columns: 1fr;
    }

    #olap-builder .olap-left {
        border-right: 0;
        border-bottom: 1px solid #e8edf2;
    }

    #olap-builder .olap-fields {
        max-height: 350px;
    }
}

@media (max-width: 650px) {

    #olap-builder .olap-zones {
        grid-template-columns: 1fr;
    }

    #olap-builder .olap-period-grid {
        grid-template-columns: 1fr;
    }
}

</style>

<div class="olap-top">

    <div class="olap-title-line">

        <div>

            <h2 class="olap-title">
                📊 OLAP Отчёт по продажам
            </h2>

            <div class="olap-subtitle">
                Конструктор отчётов iiko
            </div>

        </div>

    </div>

</div>

<div id="olap-status" class="olap-status">
    ⏳ Подготовка конструктора...
</div>

<div class="olap-tabs">

    <button
        type="button"
        class="olap-tab"
        data-template="sales"
    >
        Все
    </button>

    <button
        type="button"
        class="olap-tab"
        data-template="dish"
    >
        Блюда
    </button>

    <button
        type="button"
        class="olap-tab"
        data-template="daily"
    >
        Время
    </button>

    <button
        type="button"
        class="olap-tab"
        data-template="department"
    >
        Подразделения
    </button>

    <button
        type="button"
        class="olap-tab"
        data-template="orders"
    >
        Заказ
    </button>

</div>

<div class="olap-content">

    <div class="olap-left">

        <div class="olap-section-title">

            <span>
                Доступные поля
            </span>

            <span
                id="olap-field-count"
                class="olap-count"
            >
                0
            </span>

        </div>

        <input
            id="olap-search"
            class="olap-search"
            type="search"
            placeholder="🔎 Поиск поля..."
        >

        <div
            id="olap-fields"
            class="olap-fields"
        >

            <div class="olap-empty">
                Поля будут загружены после подключения к iiko
            </div>

        </div>

    </div>

    <div class="olap-right">

        <div class="olap-zones">

            <div class="olap-zone-block">

                <div class="olap-zone-title">
                    ↕ Строки

                    <span
                        id="olap-rows-count"
                        class="olap-zone-number"
                    >
                        0
                    </span>
                </div>

                <div
                    id="olap-rows"
                    class="olap-dropzone"
                    data-zone="rows"
                ></div>

            </div>

            <div class="olap-zone-block">

                <div class="olap-zone-title">
                    ↔ Колонки

                    <span
                        id="olap-columns-count"
                        class="olap-zone-number"
                    >
                        0
                    </span>
                </div>

                <div
                    id="olap-columns"
                    class="olap-dropzone"
                    data-zone="columns"
                ></div>

            </div>

            <div class="olap-zone-block">

                <div class="olap-zone-title">
                    📊 Показатели

                    <span
                        id="olap-measures-count"
                        class="olap-zone-number"
                    >
                        0
                    </span>
                </div>

                <div
                    id="olap-measures"
                    class="olap-dropzone"
                    data-zone="measures"
                ></div>

            </div>

            <div class="olap-zone-block">

                <div class="olap-zone-title">
                    🔎 Фильтры

                    <span
                        id="olap-filters-count"
                        class="olap-zone-number"
                    >
                        0
                    </span>
                </div>

                <div
                    id="olap-filters"
                    class="olap-dropzone"
                    data-zone="filters"
                ></div>

            </div>

        </div>

        <div class="olap-period">

            <div class="olap-period-title">
                📅 Период отчёта
            </div>

            <div class="olap-period-grid">

                <label>
                    Дата от

                    <input
                        type="date"
                        id="olap-from"
                    >
                </label>

                <label>
                    Дата до

                    <input
                        type="date"
                        id="olap-to"
                    >
                </label>

            </div>

        </div>

        <div class="olap-quick">

            <button
                type="button"
                data-template="sales"
            >
                💰 Продажи
            </button>

            <button
                type="button"
                data-template="daily"
            >
                📅 По дням
            </button>

            <button
                type="button"
                data-template="dish"
            >
                🍔 По блюдам
            </button>

            <button
                type="button"
                data-template="department"
            >
                🏢 По подразделениям
            </button>

        </div>

        <div class="olap-actions">

            <button
                type="button"
                id="olap-clear"
                class="olap-clear"
            >
                Очистить
            </button>

            <button
                type="button"
                id="olap-run"
                class="olap-run"
            >
                ▶ Построить отчёт
            </button>

        </div>

    </div>

</div>

<div
    id="olap-result"
    class="olap-result"
>

    <div class="olap-empty">
        Отчёт ещё не построен.
    </div>

</div>
`;

        container.appendChild(builder);

        setDefaultDates();

        bindOlapEvents();

        renderSelectedFields();
    }

    // ============================================================
    // DEFAULT DATES
    // ============================================================

    function setDefaultDates() {

        const today = todayString();

        const from = getElement("olap-from");
        const to = getElement("olap-to");

        if (from && !from.value) {
            from.value = today;
        }

        if (to && !to.value) {
            to.value = today;
        }

        const reportFrom =
            getElement("report-from");

        const reportTo =
            getElement("report-to");

        if (reportFrom && !reportFrom.value) {
            reportFrom.value = today;
        }

        if (reportTo && !reportTo.value) {
            reportTo.value = today;
        }
    }

    // ============================================================
    // OLAP EVENTS
    // ============================================================

    function bindOlapEvents() {

        const builder =
            getElement("olap-builder");

        if (!builder) {
            return;
        }

        const fieldsContainer =
            getElement("olap-fields");

        if (fieldsContainer) {

            fieldsContainer.addEventListener(
                "dragstart",
                function (event) {

                    const item =
                        event.target.closest(
                            ".olap-field"
                        );

                    if (!item) {
                        return;
                    }

                    event.dataTransfer.effectAllowed =
                        "copy";

                    event.dataTransfer.setData(
                        "text/plain",
                        item.dataset.field
                    );

                    item.style.opacity =
                        "0.5";
                }
            );

            fieldsContainer.addEventListener(
                "dragend",
                function (event) {

                    const item =
                        event.target.closest(
                            ".olap-field"
                        );

                    if (item) {
                        item.style.opacity = "";
                    }
                }
            );
        }

        builder
            .querySelectorAll(
                ".olap-dropzone"
            )
            .forEach(
                function (zone) {

                    zone.addEventListener(
                        "dragover",
                        function (event) {

                            event.preventDefault();

                            event.dataTransfer.dropEffect =
                                "copy";

                            zone.classList.add(
                                "over"
                            );
                        }
                    );

                    zone.addEventListener(
                        "dragleave",
                        function () {

                            zone.classList.remove(
                                "over"
                            );
                        }
                    );

                    zone.addEventListener(
                        "drop",
                        function (event) {

                            event.preventDefault();

                            zone.classList.remove(
                                "over"
                            );

                            const name =
                                event.dataTransfer.getData(
                                    "text/plain"
                                );

                            if (!name) {
                                return;
                            }

                            moveOlapField(
                                name,
                                zone.dataset.zone
                            );
                        }
                    );
                }
            );

        const search =
            getElement("olap-search");

        if (search) {

            search.addEventListener(
                "input",
                renderOlapFields
            );
        }

        const run =
            getElement("olap-run");

        if (run) {

            run.addEventListener(
                "click",
                runOlapReport
            );
        }

        const clear =
            getElement("olap-clear");

        if (clear) {

            clear.addEventListener(
                "click",
                clearOlapConstructor
            );
        }

        builder
            .querySelectorAll(
                "[data-template]"
            )
            .forEach(
                function (button) {

                    button.addEventListener(
                        "click",
                        function () {

                            applyQuickTemplate(
                                button.dataset.template
                            );
                        }
                    );
                }
            );
    }

    // ============================================================
    // LOAD OLAP FIELDS
    // ============================================================

    async function loadOlapFields() {

        if (!iikoConnection) {
            return;
        }

        const status =
            getElement("olap-status");

        const container =
            getElement("olap-fields");

        if (status) {

            status.textContent =
                "⏳ Загружаем структуру OLAP из iiko...";
        }

        if (container) {

            container.innerHTML = `

                <div class="olap-loading">
                    ⏳ Получаем поля OLAP...
                </div>

            `;
        }

        try {

            const response =
                await fetch(
                    "/api/iiko/olap",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                action:
                                    "fields",

                                reportType:
                                    "SALES",

                                ip:
                                    iikoConnection.ip,

                                port:
                                    iikoConnection.port,

                                login:
                                    iikoConnection.login,

                                password:
                                    iikoConnection.password
                            })
                    }
                );

            const data =
                await safeJson(
                    response
                );

            console.log(
                "========================================"
            );

            console.log(
                "IIKO OLAP FIELDS RESPONSE:"
            );

            console.log(
                data
            );

            console.log(
                "========================================"
            );

            if (
                !response.ok ||
                data.success === false
            ) {

                throw new Error(
                    data.message ||
                    `Ошибка получения полей OLAP HTTP ${response.status}`
                );
            }

            olapFields =
                extractOlapFields(data);

            console.log(
                "EXTRACTED OLAP FIELDS:",
                olapFields
            );

            if (!olapFields.length) {

                /*
                 * ВАЖНО:
                 *
                 * Если backend не возвращает метаданные
                 * OLAP, показываем стандартные поля iiko.
                 *
                 * Это позволяет конструктору работать
                 * даже если endpoint fields возвращает
                 * только служебный ответ.
                 */

                olapFields =
                    getFallbackOlapFields();

                console.warn(
                    "iiko не вернул структуру полей. Используем fallback-поля:",
                    olapFields
                );
            }

            renderOlapFields();

            if (status) {

                status.textContent =
                    `🟢 Доступные поля OLAP: ${olapFields.length}`;
            }

        } catch (error) {

            console.error(
                "OLAP FIELDS ERROR:",
                error
            );

            /*
             * Даже если endpoint fields
             * временно недоступен, оставляем
             * стандартный конструктор.
             */

            olapFields =
                getFallbackOlapFields();

            renderOlapFields();

            if (status) {

                status.innerHTML =
                    `⚠️ Не удалось получить структуру OLAP. ` +
                    `Доступны стандартные поля iiko (${olapFields.length}).`;
            }
        }
    }

    // ============================================================
    // FALLBACK OLAP FIELDS
    //
    // Стандартные поля, которые используются
    // iiko OLAP SALES.
    // ============================================================

    function getFallbackOlapFields() {

        return [

            {
                name: "OpenDate.Typed",
                title: "Дата открытия",
                type: "date",
                isMeasure: false
            },

            {
                name: "OpenDate",
                title: "Дата открытия",
                type: "date",
                isMeasure: false
            },

            {
                name: "CloseDate.Typed",
                title: "Дата закрытия",
                type: "date",
                isMeasure: false
            },

            {
                name: "Department",
                title: "Подразделение",
                type: "string",
                isMeasure: false
            },

            {
                name: "Department.Id",
                title: "Подразделение ID",
                type: "string",
                isMeasure: false
            },

            {
                name: "Department.Code",
                title: "Код подразделения",
                type: "string",
                isMeasure: false
            },

            {
                name: "DishName",
                title: "Блюдо",
                type: "string",
                isMeasure: false
            },

            {
                name: "DishCode",
                title: "Код блюда",
                type: "string",
                isMeasure: false
            },

            {
                name: "DishCategory",
                title: "Категория блюда",
                type: "string",
                isMeasure: false
            },

            {
                name: "DishGroup",
                title: "Группа блюд",
                type: "string",
                isMeasure: false
            },

            {
                name: "DishSize",
                title: "Размер блюда",
                type: "string",
                isMeasure: false
            },

            {
                name: "WaiterName",
                title: "Официант",
                type: "string",
                isMeasure: false
            },

            {
                name: "CashierName",
                title: "Кассир",
                type: "string",
                isMeasure: false
            },

            {
                name: "OrderType",
                title: "Тип заказа",
                type: "string",
                isMeasure: false
            },

            {
                name: "OrderType.Name",
                title: "Название типа заказа",
                type: "string",
                isMeasure: false
            },

            {
                name: "PaymentType",
                title: "Тип оплаты",
                type: "string",
                isMeasure: false
            },

            {
                name: "PaymentType.Name",
                title: "Название типа оплаты",
                type: "string",
                isMeasure: false
            },

            {
                name: "TableName",
                title: "Стол",
                type: "string",
                isMeasure: false
            },

            {
                name: "GuestCount",
                title: "Количество гостей",
                type: "number",
                isMeasure: true
            },

            {
                name: "UniqOrderId",
                title: "Уникальный заказ",
                type: "number",
                isMeasure: true
            },

            {
                name: "DishAmountInt",
                title: "Количество",
                type: "number",
                isMeasure: true
            },

            {
                name: "DishSumInt",
                title: "Сумма",
                type: "number",
                isMeasure: true
            },

            {
                name: "DishDiscountSumInt",
                title: "Скидка",
                type: "number",
                isMeasure: true
            },

            {
                name: "DishSumAfterDiscount",
                title: "Сумма после скидки",
                type: "number",
                isMeasure: true
            },

            {
                name: "DiscountPercent",
                title: "Процент скидки",
                type: "number",
                isMeasure: true
            },

            {
                name: "VAT",
                title: "НДС",
                type: "number",
                isMeasure: true
            },

            {
                name: "Cost",
                title: "Себестоимость",
                type: "number",
                isMeasure: true
            },

            {
                name: "Profit",
                title: "Прибыль",
                type: "number",
                isMeasure: true
            }
        ];
    }

    // ============================================================
    // EXTRACT OLAP FIELDS
    // ============================================================

    function extractOlapFields(data) {

        const result = [];

        const visited =
            new WeakSet();

        const dimensionKeys = [
            "dimensions",
            "dimension",
            "dimensionsFields"
        ];

        const measureKeys = [
            "measures",
            "measure",
            "metrics",
            "indicators"
        ];

        const fieldKeys = [
            "fields",
            "fieldDefinitions",
            "availableFields",
            "columns",
            "items"
        ];

        function isObject(value) {

            return (
                value !== null &&
                typeof value === "object"
            );
        }

        function addField(
            raw,
            forcedMeasure
        ) {

            if (
                raw === null ||
                raw === undefined
            ) {
                return;
            }

            if (
                typeof raw === "string"
            ) {

                const name =
                    raw.trim();

                if (!name) {
                    return;
                }

                result.push({

                    name,

                    title:
                        name,

                    type:
                        "unknown",

                    isMeasure:
                        Boolean(
                            forcedMeasure
                        )
                });

                return;
            }

            if (!isObject(raw)) {
                return;
            }

            const name =
                raw.name ||
                raw.field ||
                raw.key ||
                raw.code ||
                raw.id ||
                raw.uniqueName ||
                raw.dataField ||
                raw.property ||
                "";

            if (!name) {
                return;
            }

            const title =
                raw.title ||
                raw.caption ||
                raw.label ||
                raw.displayName ||
                raw.description ||
                raw.name ||
                raw.field ||
                name;

            const type =
                String(
                    raw.type ||
                    raw.dataType ||
                    raw.kind ||
                    raw.fieldType ||
                    raw.valueType ||
                    ""
                );

            const typeText =
                (
                    type +
                    " " +
                    String(
                        raw.name || ""
                    )
                ).toLowerCase();

            const explicitMeasure =
                raw.isMeasure === true ||
                raw.measure === true ||
                raw.is_metric === true ||
                raw.metric === true ||
                raw.isMetric === true;

            const aggregationAllowed =
                raw.aggregationAllowed === true ||
                raw.allowAggregation === true ||
                raw.canAggregate === true;

            const numeric =
                typeText.includes("number") ||
                typeText.includes("numeric") ||
                typeText.includes("decimal") ||
                typeText.includes("double") ||
                typeText.includes("float") ||
                typeText.includes("integer") ||
                typeText.includes("money") ||
                typeText.includes("currency") ||
                typeText.includes("measure");

            result.push({

                ...raw,

                name:
                    String(name),

                title:
                    String(title),

                type,

                isMeasure:
                    forcedMeasure === true ||
                    explicitMeasure ||
                    aggregationAllowed ||
                    numeric
            });
        }

        function scan(
            value,
            context
        ) {

            if (
                value === null ||
                value === undefined
            ) {
                return;
            }

            if (
                typeof value !== "object"
            ) {
                return;
            }

            if (
                visited.has(value)
            ) {
                return;
            }

            visited.add(value);

            if (Array.isArray(value)) {

                value.forEach(
                    function (item) {

                        scan(
                            item,
                            context
                        );
                    }
                );

                return;
            }

            dimensionKeys.forEach(
                function (key) {

                    const child =
                        value[key];

                    if (
                        Array.isArray(child)
                    ) {

                        child.forEach(
                            function (item) {

                                addField(
                                    item,
                                    false
                                );
                            }
                        );
                    }
                }
            );

            measureKeys.forEach(
                function (key) {

                    const child =
                        value[key];

                    if (
                        Array.isArray(child)
                    ) {

                        child.forEach(
                            function (item) {

                                addField(
                                    item,
                                    true
                                );
                            }
                        );
                    }
                }
            );

            fieldKeys.forEach(
                function (key) {

                    const child =
                        value[key];

                    if (
                        Array.isArray(child)
                    ) {

                        child.forEach(
                            function (item) {

                                addField(
                                    item,
                                    context ===
                                    "measure"
                                );
                            }
                        );
                    }
                }
            );

            const looksLikeField =
                Boolean(
                    value.name ||
                    value.field ||
                    value.key ||
                    value.code ||
                    value.uniqueName
                );

            if (looksLikeField) {

                addField(
                    value,
                    context === "measure"
                );
            }

            Object.keys(value)
                .forEach(
                    function (key) {

                        const child =
                            value[key];

                        if (
                            child === null ||
                            child === undefined
                        ) {
                            return;
                        }

                        const lower =
                            key.toLowerCase();

                        let nextContext =
                            context;

                        if (
                            measureKeys.includes(
                                key
                            ) ||
                            lower.includes(
                                "measure"
                            ) ||
                            lower.includes(
                                "metric"
                            )
                        ) {

                            nextContext =
                                "measure";
                        }

                        if (
                            dimensionKeys.includes(
                                key
                            ) ||
                            lower.includes(
                                "dimension"
                            )
                        ) {

                            nextContext =
                                "dimension";
                        }

                        if (
                            typeof child ===
                            "object"
                        ) {

                            scan(
                                child,
                                nextContext
                            );
                        }
                    }
                );
        }

        scan(
            data,
            "dimension"
        );

        // --------------------------------------------------------
        // Unique
        // --------------------------------------------------------

        const unique =
            new Map();

        result.forEach(
            function (field) {

                if (
                    !field ||
                    !field.name
                ) {
                    return;
                }

                const name =
                    String(
                        field.name
                    ).trim();

                if (!name) {
                    return;
                }

                if (!unique.has(name)) {

                    unique.set(
                        name,
                        {
                            ...field,
                            name
                        }
                    );

                } else {

                    const old =
                        unique.get(name);

                    unique.set(
                        name,
                        {
                            ...old,
                            ...field,
                            name,

                            isMeasure:
                                Boolean(
                                    old.isMeasure ||
                                    field.isMeasure
                                )
                        }
                    );
                }
            }
        );

        return Array.from(
            unique.values()
        );
    }

    // ============================================================
    // RENDER AVAILABLE FIELDS
    // ============================================================

    function renderOlapFields() {

        const container =
            getElement("olap-fields");

        if (!container) {
            return;
        }

        const searchInput =
            getElement("olap-search");

        const search =
            searchInput
                ? searchInput.value
                    .trim()
                    .toLowerCase()
                : "";

        const filtered =
            olapFields.filter(
                function (field) {

                    const text =
                        [
                            field.name,
                            field.title,
                            field.type
                        ]
                            .join(" ")
                            .toLowerCase();

                    return text.includes(
                        search
                    );
                }
            );

        const count =
            getElement(
                "olap-field-count"
            );

        if (count) {

            count.textContent =
                `${filtered.length}/${olapFields.length}`;
        }

        if (!filtered.length) {

            container.innerHTML = `

                <div class="olap-empty">

                    ${
                        olapFields.length
                            ? "По вашему запросу ничего не найдено"
                            : "Поля iiko не найдены"
                    }

                </div>

            `;

            return;
        }

        container.innerHTML = "";

        filtered.forEach(
            function (field) {

                const button =
                    document.createElement(
                        "button"
                    );

                button.type =
                    "button";

                button.className =
                    "olap-field";

                button.draggable =
                    true;

                button.dataset.field =
                    field.name;

                button.title =
                    "Перетащите поле в нужную область";

                button.innerHTML = `

                    <span class="olap-icon">

                        ${
                            field.isMeasure
                                ? "📊"
                                : "▤"
                        }

                    </span>

                    <span class="olap-field-name">

                        <strong>
                            ${escapeHtml(
                                field.title ||
                                field.name
                            )}
                        </strong>

                        <small>
                            ${escapeHtml(
                                field.name
                            )}
                        </small>

                    </span>

                    <span class="olap-plus">
                        ＋
                    </span>

                `;

                button.addEventListener(
                    "click",
                    function () {

                        moveOlapField(
                            field.name,

                            field.isMeasure
                                ? "measures"
                                : "rows"
                        );
                    }
                );

                container.appendChild(
                    button
                );
            }
        );
    }

    // ============================================================
    // FIELD STATE
    // ============================================================

    function removeFromAllGroups(name) {

        olapRows =
            olapRows.filter(
                function (field) {

                    return field.name !== name;
                }
            );

        olapColumns =
            olapColumns.filter(
                function (field) {

                    return field.name !== name;
                }
            );

        olapMeasures =
            olapMeasures.filter(
                function (field) {

                    return field.name !== name;
                }
            );

        olapFilters =
            olapFilters.filter(
                function (field) {

                    return field.name !== name;
                }
            );
    }

    function findSelectedField(name) {

        return [
            ...olapRows,
            ...olapColumns,
            ...olapMeasures,
            ...olapFilters
        ].find(
            function (field) {

                return field.name === name;
            }
        );
    }

    function moveOlapField(
        name,
        zone
    ) {

        const field =
            olapFields.find(
                function (item) {

                    return item.name === name;
                }
            );

        if (!field) {

            console.warn(
                "Поле не найдено:",
                name
            );

            return;
        }

        const previous =
            findSelectedField(
                name
            );

        removeFromAllGroups(
            name
        );

        const copy = {

            ...field,

            aggregation:
                previous &&
                previous.aggregation
                    ? previous.aggregation
                    : "SUM"
        };

        if (zone === "rows") {
            olapRows.push(copy);
        }

        if (zone === "columns") {
            olapColumns.push(copy);
        }

        if (zone === "measures") {
            olapMeasures.push(copy);
        }

        if (zone === "filters") {
            olapFilters.push(copy);
        }

        renderSelectedFields();
    }

    // ============================================================
    // RENDER SELECTED FIELDS
    // ============================================================

    function renderSelectedFields() {

        renderZone(
            "olap-rows",
            olapRows,
            "rows"
        );

        renderZone(
            "olap-columns",
            olapColumns,
            "columns"
        );

        renderZone(
            "olap-measures",
            olapMeasures,
            "measures"
        );

        renderZone(
            "olap-filters",
            olapFilters,
            "filters"
        );

        updateCounts();
    }

    function renderZone(
        elementId,
        fields,
        group
    ) {

        const container =
            getElement(elementId);

        if (!container) {
            return;
        }

        if (!fields.length) {

            const messages = {

                rows:
                    "Перетащите сюда поля строк",

                columns:
                    "Перетащите сюда поля колонок",

                measures:
                    "Перетащите сюда показатели",

                filters:
                    "Перетащите сюда фильтры"
            };

            container.classList.remove(
                "has-items"
            );

            container.innerHTML = `

                <div class="olap-empty">
                    ${messages[group]}
                </div>

            `;

            return;
        }

        container.classList.add(
            "has-items"
        );

        container.innerHTML = "";

        fields.forEach(
            function (field) {

                const chip =
                    document.createElement(
                        "div"
                    );

                chip.className =
                    "olap-chip";

                chip.draggable =
                    true;

                chip.dataset.field =
                    field.name;

                const aggregation =
                    field.aggregation ||
                    "SUM";

                chip.innerHTML = `

                    <span class="olap-icon">

                        ${
                            field.isMeasure
                                ? "📊"
                                : "▤"
                        }

                    </span>

                    <span class="olap-chip-text">

                        <strong>
                            ${escapeHtml(
                                field.title ||
                                field.name
                            )}
                        </strong>

                        <small>
                            ${escapeHtml(
                                field.name
                            )}
                        </small>

                    </span>

                    ${
                        group === "measures"
                            ? `

                                <select
                                    class="olap-aggregation"
                                    title="Агрегация"
                                >

                                    <option
                                        value="SUM"
                                        ${
                                            aggregation === "SUM"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        SUM
                                    </option>

                                    <option
                                        value="COUNT"
                                        ${
                                            aggregation === "COUNT"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        COUNT
                                    </option>

                                    <option
                                        value="AVG"
                                        ${
                                            aggregation === "AVG"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        AVG
                                    </option>

                                    <option
                                        value="MIN"
                                        ${
                                            aggregation === "MIN"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        MIN
                                    </option>

                                    <option
                                        value="MAX"
                                        ${
                                            aggregation === "MAX"
                                                ? "selected"
                                                : ""
                                        }
                                    >
                                        MAX
                                    </option>

                                </select>

                            `
                            : ""
                    }

                    <button
                        type="button"
                        class="olap-remove"
                        title="Удалить"
                    >
                        ×
                    </button>

                `;

                // ------------------------------------------------
                // Drag
                // ------------------------------------------------

                chip.addEventListener(
                    "dragstart",
                    function (event) {

                        event.dataTransfer.effectAllowed =
                            "move";

                        event.dataTransfer.setData(
                            "text/plain",
                            field.name
                        );

                        chip.style.opacity =
                            "0.5";
                    }
                );

                chip.addEventListener(
                    "dragend",
                    function () {

                        chip.style.opacity =
                            "";
                    }
                );

                // ------------------------------------------------
                // Remove
                // ------------------------------------------------

                const removeButton =
                    chip.querySelector(
                        ".olap-remove"
                    );

                if (removeButton) {

                    removeButton.addEventListener(
                        "click",
                        function () {

                            removeFromAllGroups(
                                field.name
                            );

                            renderSelectedFields();
                        }
                    );
                }

                // ------------------------------------------------
                // Aggregation
                // ------------------------------------------------

                const aggregationSelect =
                    chip.querySelector(
                        ".olap-aggregation"
                    );

                if (aggregationSelect) {

                    aggregationSelect.addEventListener(
                        "change",
                        function () {

                            field.aggregation =
                                aggregationSelect.value;
                        }
                    );
                }

                container.appendChild(
                    chip
                );
            }
        );
    }

    // ============================================================
    // COUNTS
    // ============================================================

    function updateCounts() {

        const values = {

            "olap-rows-count":
                olapRows.length,

            "olap-columns-count":
                olapColumns.length,

            "olap-measures-count":
                olapMeasures.length,

            "olap-filters-count":
                olapFilters.length
        };

        Object.entries(values)
            .forEach(
                function ([id, value]) {

                    const element =
                        getElement(id);

                    if (element) {

                        element.textContent =
                            value;
                    }
                }
            );
    }

    // ============================================================
    // CLEAR
    // ============================================================

    function clearOlapConstructor() {

        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];

        const result =
            getElement(
                "olap-result"
            );

        if (result) {

            result.innerHTML = `

                <div class="olap-empty">
                    Отчёт ещё не построен.
                </div>

            `;
        }

        renderSelectedFields();
    }

    // ============================================================
    // FIND FIELD
    // ============================================================

    function findOlapField() {

        const names =
            Array.from(arguments)
                .map(
                    function (value) {

                        return String(
                            value
                        ).toLowerCase();
                    }
                );

        return olapFields.find(
            function (field) {

                const name =
                    String(
                        field.name || ""
                    ).toLowerCase();

                const title =
                    String(
                        field.title || ""
                    ).toLowerCase();

                return names.some(
                    function (search) {

                        return (
                            name === search ||
                            title === search ||
                            name.includes(search) ||
                            title.includes(search)
                        );
                    }
                );
            }
        );
    }

    // ============================================================
    // QUICK TEMPLATES
    // ============================================================

    function applyQuickTemplate(type) {

        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];

        const date =
            findOlapField(
                "OpenDate.Typed",
                "OpenDate",
                "Дата открытия",
                "Учетный день",
                "Дата"
            );

        const dish =
            findOlapField(
                "DishName",
                "Блюдо",
                "Dish",
                "Название блюда"
            );

        const department =
            findOlapField(
                "Department",
                "Подразделение",
                "Department.Id",
                "Подразделение.Id"
            );

        const sales =
            findOlapField(
                "DishSumInt",
                "Сумма без скидки",
                "Сумма",
                "Выручка",
                "Продажи"
            );

        const orders =
            findOlapField(
                "UniqOrderId",
                "Заказ",
                "Количество заказов"
            );

        console.log(
            "TEMPLATE FIELDS:",
            {
                date,
                dish,
                department,
                sales,
                orders
            }
        );

        if (type === "sales") {

            if (date) {

                olapRows.push({
                    ...date
                });
            }

            if (sales) {

                olapMeasures.push({
                    ...sales,
                    aggregation: "SUM"
                });
            }

            if (orders) {

                olapMeasures.push({
                    ...orders,
                    aggregation: "COUNT"
                });
            }
        }

        if (type === "daily") {

            if (date) {

                olapRows.push({
                    ...date
                });
            }

            if (sales) {

                olapMeasures.push({
                    ...sales,
                    aggregation: "SUM"
                });
            }
        }

        if (type === "dish") {

            if (dish) {

                olapRows.push({
                    ...dish
                });
            }

            if (sales) {

                olapMeasures.push({
                    ...sales,
                    aggregation: "SUM"
                });
            }

            if (orders) {

                olapMeasures.push({
                    ...orders,
                    aggregation: "COUNT"
                });
            }
        }

        if (type === "department") {

            if (department) {

                olapRows.push({
                    ...department
                });
            }

            if (sales) {

                olapMeasures.push({
                    ...sales,
                    aggregation: "SUM"
                });
            }

            if (orders) {

                olapMeasures.push({
                    ...orders,
                    aggregation: "COUNT"
                });
            }
        }

        if (type === "orders") {

            if (orders) {

                olapRows.push({
                    ...orders
                });
            }

            if (sales) {

                olapMeasures.push({
                    ...sales,
                    aggregation: "SUM"
                });
            }
        }

        renderSelectedFields();
    }

    // ============================================================
    // RUN OLAP REPORT
    // ============================================================

    async function runOlapReport() {

        if (!iikoConnection) {

            showOlapError(
                "Сначала подключитесь к iiko Server"
            );

            return;
        }

        const fromElement =
            getElement("olap-from");

        const toElement =
            getElement("olap-to");

        const from =
            fromElement
                ? fromElement.value
                : "";

        const to =
            toElement
                ? toElement.value
                : "";

        if (!from || !to) {

            showOlapError(
                "Выберите период отчёта"
            );

            return;
        }

        if (from > to) {

            showOlapError(
                "Дата начала не может быть позже даты окончания"
            );

            return;
        }

        if (
            !olapRows.length &&
            !olapColumns.length &&
            !olapMeasures.length
        ) {

            showOlapError(
                "Перетащите хотя бы одно поле в конструктор"
            );

            return;
        }

        const button =
            getElement("olap-run");

        const result =
            getElement("olap-result");

        if (button) {

            button.disabled =
                true;

            button.textContent =
                "⏳ Построение...";
        }

        if (result) {

            result.innerHTML = `

                <div class="olap-loading">
                    ⏳ Отправляем запрос в iiko OLAP...
                </div>

            `;
        }

        const payload = {

            action:
                "query",

            ip:
                iikoConnection.ip,

            port:
                iikoConnection.port,

            login:
                iikoConnection.login,

            password:
                iikoConnection.password,

            reportType:
                "SALES",

            from,
            to,

            rows:
                olapRows.map(
                    function (field) {

                        return field.name;
                    }
                ),

            columns:
                olapColumns.map(
                    function (field) {

                        return field.name;
                    }
                ),

            measures:
                olapMeasures.map(
                    function (field) {

                        return {

                            field:
                                field.name,

                            aggregation:
                                field.aggregation ||
                                "SUM"
                        };
                    }
                ),

            filters:
                olapFilters.map(
                    function (field) {

                        return {

                            field:
                                field.name
                        };
                    }
                )
        };

        console.log(
            "========================================"
        );

        console.log(
            "IIKO OLAP REQUEST:"
        );

        console.log(
            JSON.stringify(
                payload,
                null,
                2
            )
        );

        console.log(
            "========================================"
        );

        try {

            const response =
                await fetch(
                    "/api/iiko/olap",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

            const data =
                await safeJson(
                    response
                );

            console.log(
                "IIKO OLAP RESPONSE:",
                data
            );

            if (
                !response.ok ||
                data.success === false
            ) {

                throw new Error(
                    data.message ||
                    `Ошибка OLAP HTTP ${response.status}`
                );
            }

            renderOlapResult(
                data,
                from,
                to
            );

        } catch (error) {

            console.error(
                "OLAP ERROR:",
                error
            );

            if (result) {

                result.innerHTML = `

                    <div class="olap-error">

                        🔴 ${escapeHtml(
                            error.message
                        )}

                    </div>

                `;
            }

        } finally {

            if (button) {

                button.disabled =
                    false;

                button.textContent =
                    "▶ Построить отчёт";
            }
        }
    }

    // ============================================================
    // GET REPORT ROWS
    // ============================================================

    function getReportRows(data) {

        let report =
            data.report ||
            data.data ||
            data.result ||
            {};

        if (
            report &&
            Array.isArray(
                report.data
            )
        ) {

            return report.data;
        }

        if (
            Array.isArray(
                report
            )
        ) {

            return report;
        }

        if (
            Array.isArray(
                data.data
            )
        ) {

            return data.data;
        }

        if (
            data.rawResponse
        ) {

            try {

                const raw =
                    typeof data.rawResponse ===
                    "string"
                        ? JSON.parse(
                            data.rawResponse
                        )
                        : data.rawResponse;

                if (
                    raw &&
                    Array.isArray(
                        raw.data
                    )
                ) {

                    return raw.data;
                }

            } catch (error) {

                console.warn(
                    "Ошибка разбора rawResponse:",
                    error
                );
            }
        }

        return [];
    }

    // ============================================================
    // RENDER OLAP RESULT
    // ============================================================

    function renderOlapResult(
        data,
        from,
        to
    ) {

        const result =
            getElement(
                "olap-result"
            );

        if (!result) {
            return;
        }

        const rows =
            getReportRows(
                data
            );

        let html = `

            <h3>
                📊 Результат OLAP
            </h3>

            <div style="
                margin-bottom:12px;
                color:#718096;
                font-size:11px;
            ">

                Период:
                ${formatDate(from)}
                —
                ${formatDate(to)}

            </div>

        `;

        if (!rows.length) {

            html += `

                <div class="olap-empty">

                    За выбранный период
                    данных нет.

                </div>

            `;

        } else {

            html +=
                createResultTable(
                    rows
                );
        }

        html += `

            <details style="
                margin-top:16px;
            ">

                <summary style="
                    cursor:pointer;
                    color:#66758a;
                    font-size:11px;
                    font-weight:700;
                ">

                    Технический ответ iiko

                </summary>

                <pre style="
                    margin-top:8px;
                    padding:12px;
                    background:#f5f7f9;
                    border:1px solid #e0e5ea;
                    border-radius:7px;
                    overflow:auto;
                    font-size:10px;
                    white-space:pre-wrap;
                ">${escapeHtml(
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                )}</pre>

            </details>

        `;

        result.innerHTML =
            html;
    }

    // ============================================================
    // CREATE RESULT TABLE
    // ============================================================

    function createResultTable(rows) {

        const columns = [];

        rows.forEach(
            function (row) {

                if (
                    !row ||
                    typeof row !== "object"
                ) {
                    return;
                }

                Object.keys(row)
                    .forEach(
                        function (key) {

                            if (
                                !columns.includes(
                                    key
                                )
                            ) {

                                columns.push(
                                    key
                                );
                            }
                        }
                    );
            }
        );

        if (!columns.length) {

            return `

                <div class="olap-empty">
                    iiko не вернул колонки.
                </div>

            `;
        }

        let html = `

            <table class="olap-result-table">

                <thead>

                    <tr>

        `;

        columns.forEach(
            function (column) {

                html += `

                    <th>
                        ${escapeHtml(
                            getFieldTitle(
                                column
                            )
                        )}
                    </th>

                `;
            }
        );

        html += `

                    </tr>

                </thead>

                <tbody>

        `;

        rows.forEach(
            function (row) {

                html += "<tr>";

                columns.forEach(
                    function (column) {

                        html += `

                            <td>
                                ${formatCell(
                                    row[column]
                                )}
                            </td>

                        `;
                    }
                );

                html += "</tr>";
            }
        );

        html += `

                </tbody>

            </table>

        `;

        return html;
    }

    // ============================================================
    // FIELD TITLE
    // ============================================================

    function getFieldTitle(name) {

        const field =
            olapFields.find(
                function (item) {

                    return item.name === name;
                }
            );

        return field
            ? (
                field.title ||
                field.name
            )
            : name;
    }

    // ============================================================
    // FORMAT CELL
    // ============================================================

    function formatCell(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return "";
        }

        if (
            typeof value === "number"
        ) {

            return formatNumber(
                value
            );
        }

        if (
            typeof value === "object"
        ) {

            return escapeHtml(
                JSON.stringify(
                    value
                )
            );
        }

        return escapeHtml(
            value
        );
    }

    // ============================================================
    // ERROR
    // ============================================================

    function showOlapError(message) {

        const result =
            getElement(
                "olap-result"
            );

        if (!result) {
            return;
        }

        result.innerHTML = `

            <div class="olap-error">

                🔴 ${escapeHtml(
                    message
                )}

            </div>

        `;
    }

    // ============================================================
    // SALES REPORT
    // ============================================================

    if (loadSalesButton) {

        loadSalesButton.addEventListener(
            "click",
            async function () {

                if (!iikoConnection) {

                    if (salesResult) {

                        salesResult.innerHTML = `

                            <div class="report-error">
                                ⚠️ Сначала подключитесь к iiko Server
                            </div>

                        `;
                    }

                    return;
                }

                const fromElement =
                    getElement(
                        "report-from"
                    );

                const toElement =
                    getElement(
                        "report-to"
                    );

                const from =
                    fromElement
                        ? fromElement.value
                        : "";

                const to =
                    toElement
                        ? toElement.value
                        : "";

                if (!from || !to) {

                    if (salesResult) {

                        salesResult.innerHTML = `

                            <div class="report-error">
                                ⚠️ Выберите период
                            </div>

                        `;
                    }

                    return;
                }

                if (from > to) {

                    if (salesResult) {

                        salesResult.innerHTML = `

                            <div class="report-error">
                                ⚠️ Неверный период
                            </div>

                        `;
                    }

                    return;
                }

                loadSalesButton.disabled =
                    true;

                loadSalesButton.textContent =
                    "Загрузка...";

                if (salesResult) {

                    salesResult.innerHTML = `

                        <div class="report-loading">
                            ⏳ Получаем данные из iiko...
                        </div>

                    `;
                }

                try {

                    const response =
                        await fetch(
                            "/api/iiko/sales",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({

                                        ip:
                                            iikoConnection.ip,

                                        port:
                                            iikoConnection.port,

                                        login:
                                            iikoConnection.login,

                                        password:
                                            iikoConnection.password,

                                        from,
                                        to
                                    })
                            }
                        );

                    const data =
                        await safeJson(
                            response
                        );

                    if (
                        !response.ok ||
                        data.success === false
                    ) {

                        throw new Error(
                            data.message ||
                            "Ошибка получения продаж"
                        );
                    }

                    renderSalesReport(
                        data,
                        from,
                        to
                    );

                } catch (error) {

                    console.error(
                        "SALES ERROR:",
                        error
                    );

                    if (salesResult) {

                        salesResult.innerHTML = `

                            <div class="report-error">

                                🔴 ${escapeHtml(
                                    error.message
                                )}

                            </div>

                        `;
                    }

                } finally {

                    loadSalesButton.disabled =
                        false;

                    loadSalesButton.textContent =
                        "Получить отчёт";
                }
            }
        );
    }

    // ============================================================
    // SALES RESULT
    // ============================================================

    function renderSalesReport(
        data,
        from,
        to
    ) {

        if (!salesResult) {
            return;
        }

        const report =
            data.report || {};

        const rows =
            Array.isArray(
                report.data
            )
                ? report.data
                : [];

        let totalSales = 0;
        let totalOrders = 0;

        rows.forEach(
            function (row) {

                totalSales +=
                    Number(
                        row.DishSumInt ||
                        0
                    );

                totalOrders +=
                    Number(
                        row.UniqOrderId ||
                        0
                    );
            }
        );

        const averageCheck =
            totalOrders
                ? totalSales /
                    totalOrders
                : 0;

        let html = `

            <div class="report-header">

                <h2>
                    📊 Отчёт о продажах
                </h2>

                <div class="report-period">
                    ${formatDate(from)}
                    —
                    ${formatDate(to)}
                </div>

            </div>

            <div class="report-cards">

                <div class="report-card">

                    <div class="report-card-title">
                        💰 Выручка
                    </div>

                    <div class="report-card-value">
                        ${formatMoney(
                            totalSales
                        )}
                    </div>

                </div>

                <div class="report-card">

                    <div class="report-card-title">
                        🧾 Заказы
                    </div>

                    <div class="report-card-value">
                        ${formatNumber(
                            totalOrders
                        )}
                    </div>

                </div>

                <div class="report-card">

                    <div class="report-card-title">
                        💵 Средний чек
                    </div>

                    <div class="report-card-value">
                        ${formatMoney(
                            averageCheck
                        )}
                    </div>

                </div>

            </div>

            <div class="report-table-wrapper">

                <h3>
                    Продажи
                </h3>

                <table class="report-table">

                    <thead>

                        <tr>

                            <th>
                                Дата
                            </th>

                            <th>
                                Выручка
                            </th>

                            <th>
                                Заказы
                            </th>

                            <th>
                                Средний чек
                            </th>

                        </tr>

                    </thead>

                    <tbody>

        `;

        if (!rows.length) {

            html += `

                <tr>

                    <td
                        colspan="4"
                        class="empty-report"
                    >
                        Продаж за выбранный период нет
                    </td>

                </tr>

            `;

        } else {

            rows.forEach(
                function (row) {

                    const sales =
                        Number(
                            row.DishSumInt ||
                            0
                        );

                    const orders =
                        Number(
                            row.UniqOrderId ||
                            0
                        );

                    const average =
                        orders
                            ? sales /
                                orders
                            : 0;

                    const date =
                        row[
                            "OpenDate.Typed"
                        ] ||
                        row.OpenDate ||
                        "";

                    html += `

                        <tr>

                            <td>

                                ${formatDate(
                                    String(
                                        date
                                    ).slice(
                                        0,
                                        10
                                    )
                                )}

                            </td>

                            <td>

                                ${formatMoney(
                                    sales
                                )}

                            </td>

                            <td>

                                ${formatNumber(
                                    orders
                                )}

                            </td>

                            <td>

                                ${formatMoney(
                                    average
                                )}

                            </td>

                        </tr>

                    `;
                }
            );
        }

        html += `

                    </tbody>

                </table>

            </div>

        `;

        salesResult.innerHTML =
            html;
    }

    // ============================================================
    // START
    // ============================================================

    loadSavedIikoData();

})();
