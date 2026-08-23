// ============================================================
// ANAR SYSTEM — REPORTS + IIKO OLAP CONSTRUCTOR
// reports.js — FULL REPLACEMENT VERSION
// ============================================================

(function () {
    "use strict";

    // ============================================================
    // HELPERS
    // ============================================================

    const $ = (id) => document.getElementById(id);

    const escapeHtml = (value) =>
        String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    const todayString = () => {
        const date = new Date();

        return `${date.getFullYear()}-${String(
            date.getMonth() + 1
        ).padStart(2, "0")}-${String(
            date.getDate()
        ).padStart(2, "0")}`;
    };

    const formatDate = (value) => {
        if (!value) return "";

        const parts = String(value)
            .slice(0, 10)
            .split("-");

        if (parts.length !== 3) {
            return String(value);
        }

        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    };

    const formatNumber = (value) => {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return escapeHtml(value);
        }

        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(number);
    };

    const formatMoney = (value) => {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return "0,00";
        }

        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(number);
    };

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
                message: text.slice(0, 2000),
                rawText: text
            };
        }
    }

    // ============================================================
    // STATE
    // ============================================================

    let iikoConnection = null;

    let olapFields = [];

    let olapRows = [];
    let olapColumns = [];
    let olapMeasures = [];
    let olapFilters = [];

    const IIKO_STORAGE_KEY = "iikoConnection";

    // ============================================================
    // LOAD SAVED IIKO DATA
    // ============================================================

    function loadSavedIikoData() {
        try {
            const saved =
                localStorage.getItem(
                    IIKO_STORAGE_KEY
                );

            if (!saved) {
                return;
            }

            const data = JSON.parse(saved);

            const ip = $("iiko-ip");
            const port = $("iiko-port");
            const login = $("iiko-login");

            if (ip) {
                ip.value = data.ip || "";
            }

            if (port) {
                port.value = data.port || "";
            }

            if (login) {
                login.value = data.login || "";
            }

            const remember = $("remember-iiko");

            if (remember) {
                remember.checked = true;
            }
        } catch (error) {
            console.error(
                "Ошибка загрузки сохранённых данных iiko:",
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
        const ip = $("iiko-ip");
        const port = $("iiko-port");
        const login = $("iiko-login");

        const data = {
            ip: ip
                ? ip.value.trim()
                : "",

            port: port
                ? port.value.trim()
                : "",

            login: login
                ? login.value.trim()
                : ""
        };

        localStorage.setItem(
            IIKO_STORAGE_KEY,
            JSON.stringify(data)
        );
    }

    // ============================================================
    // CLEAR IIKO DATA
    // ============================================================

    function clearIikoData() {
        localStorage.removeItem(
            IIKO_STORAGE_KEY
        );

        [
            "iiko-ip",
            "iiko-port",
            "iiko-login",
            "iiko-password"
        ].forEach((id) => {
            const element = $(id);

            if (element) {
                element.value = "";
            }
        });

        const remember = $("remember-iiko");

        if (remember) {
            remember.checked = false;
        }

        iikoConnection = null;

        const salesCard = $("sales-card");

        if (salesCard) {
            salesCard.style.display = "none";
        }

        const status = $("iiko-status");

        if (status) {
            status.textContent =
                "⚪ Данные iiko удалены";
        }

        const salesResult = $("sales-result");

        if (salesResult) {
            salesResult.innerHTML = "";
        }

        const builder = $("olap-builder");

        if (builder) {
            builder.remove();
        }

        olapFields = [];
        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];
    }

    const clearIikoButton =
        $("clear-iiko-data");

    if (clearIikoButton) {
        clearIikoButton.addEventListener(
            "click",
            clearIikoData
        );
    }

    // ============================================================
    // CONNECT IIKO
    // ============================================================

    const connectButton =
        $("connect-iiko");

    if (connectButton) {
        connectButton.addEventListener(
            "click",
            async function () {

                const ip =
                    $("iiko-ip")
                        ?.value
                        .trim() || "";

                const port =
                    $("iiko-port")
                        ?.value
                        .trim() || "";

                const login =
                    $("iiko-login")
                        ?.value
                        .trim() || "";

                const password =
                    $("iiko-password")
                        ?.value || "";

                const status =
                    $("iiko-status");

                if (
                    !ip ||
                    !port ||
                    !login ||
                    !password
                ) {
                    if (status) {
                        status.textContent =
                            "⚠️ Заполните IP, порт, логин и пароль";
                    }

                    return;
                }

                connectButton.disabled = true;

                connectButton.textContent =
                    "Подключение...";

                if (status) {
                    status.textContent =
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
                        "IIKO CONNECT RESPONSE:",
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

                    const remember =
                        $("remember-iiko");

                    if (
                        remember &&
                        remember.checked
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

                    if (status) {
                        status.textContent =
                            "🟢 iiko Server подключён";
                    }

                    const salesCard =
                        $("sales-card");

                    if (salesCard) {
                        salesCard.style.display =
                            "block";
                    }

                    createOlapBuilder();

                    await loadOlapFields();

                } catch (error) {

                    console.error(
                        "IIKO CONNECT ERROR:",
                        error
                    );

                    if (status) {
                        status.textContent =
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

        if ($("olap-builder")) {
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
            document.createElement(
                "section"
            );

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

#olap-builder .olap-tab,
#olap-builder .olap-quick button,
#olap-builder .olap-clear {
    border: 1px solid #d8e0e8;
    background: #ffffff;
    border-radius: 7px;
    padding: 7px 11px;
    cursor: pointer;
    font-size: 11px;
    color: #405066;
    white-space: nowrap;
}

#olap-builder .olap-tab:hover,
#olap-builder .olap-quick button:hover,
#olap-builder .olap-clear:hover {
    background: #f3f6f9;
}

#olap-builder .olap-content {
    display: grid;
    grid-template-columns: 330px 1fr;
    min-height: 570px;
}

#olap-builder .olap-left {
    padding: 18px;
    background: #f8fafc;
    border-right: 1px solid #e8edf2;
}

#olap-builder .olap-right {
    padding: 18px;
    min-width: 0;
}

#olap-builder .olap-section-title {
    display: flex;
    justify-content: space-between;
    margin-bottom: 9px;
    font-size: 12px;
    font-weight: 800;
    color: #46566d;
}

#olap-builder .olap-count {
    color: #9aa5b4;
}

#olap-builder .olap-search {
    width: 100%;
    height: 40px;
    border: 1px solid #d8e0e8;
    border-radius: 8px;
    padding: 0 10px;
    outline: none;
    background: #ffffff;
}

#olap-builder .olap-search:focus {
    border-color: #8796a7;
}

#olap-builder .olap-fields {
    margin-top: 10px;
    max-height: 500px;
    overflow-y: auto;
}

#olap-builder .olap-field {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 45px;
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

#olap-builder .olap-icon {
    width: 27px;
    height: 27px;
    display: grid;
    place-items: center;
    background: #eef2f6;
    border-radius: 6px;
    flex: 0 0 27px;
}

#olap-builder .olap-field-name {
    min-width: 0;
    flex: 1;
}

#olap-builder .olap-field-name strong,
#olap-builder .olap-chip-text strong {
    display: block;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-field-name small,
#olap-builder .olap-chip-text small {
    display: block;
    margin-top: 2px;
    color: #8b98a8;
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#olap-builder .olap-zones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

#olap-builder .olap-zone-title {
    margin-bottom: 7px;
    font-size: 12px;
    font-weight: 800;
    color: #43536a;
}

#olap-builder .olap-zone-number {
    float: right;
    color: #9aa5b4;
}

#olap-builder .olap-dropzone {
    min-height: 108px;
    padding: 7px;
    border: 1px dashed #c8d1dc;
    border-radius: 9px;
    background: #fafbfd;
}

#olap-builder .olap-dropzone.over {
    background: #f0f3f6;
    border-color: #66778b;
}

#olap-builder .olap-empty {
    min-height: 90px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 10px;
    color: #9aa5b4;
    font-size: 11px;
}

#olap-builder .olap-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 43px;
    margin-bottom: 5px;
    padding: 5px 6px;
    border: 1px solid #dfe5eb;
    border-radius: 7px;
    background: #ffffff;
    cursor: grab;
}

#olap-builder .olap-chip:last-child {
    margin-bottom: 0;
}

#olap-builder .olap-chip-text {
    flex: 1;
    min-width: 0;
}

#olap-builder .olap-aggregation,
#olap-builder .olap-filter-operator {
    height: 29px;
    border: 1px solid #d8e0e8;
    border-radius: 6px;
    background: #f8fafc;
    font-size: 9px;
    max-width: 110px;
}

#olap-builder .olap-filter-controls {
    flex: 1;
    min-width: 95px;
}

#olap-builder .olap-filter-value {
    width: 100%;
    height: 29px;
    margin-top: 4px;
    border: 1px solid #d8e0e8;
    border-radius: 6px;
    padding: 0 6px;
    font-size: 10px;
}

#olap-builder .olap-remove {
    border: 0;
    background: transparent;
    color: #9aa5b4;
    cursor: pointer;
    font-size: 17px;
    width: 24px;
    height: 28px;
}

#olap-builder .olap-remove:hover {
    color: #d22d2d;
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
    padding: 0 7px;
}

#olap-builder .olap-quick {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
}

#olap-builder .olap-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

#olap-builder .olap-run {
    flex: 1;
    min-height: 43px;
    border: 0;
    border-radius: 7px;
    background: #20252b;
    color: #ffffff;
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

#olap-builder .olap-result {
    border-top: 1px solid #e8edf2;
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

    <h2 class="olap-title">
        📊 OLAP Отчёт по продажам
    </h2>

    <div class="olap-subtitle">
        Конструктор iiko — строки, колонки,
        показатели и фильтры.
    </div>

</div>

<div
    id="olap-status"
    class="olap-status"
>
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
                Поля будут загружены после подключения
            </div>
        </div>

    </div>

    <div class="olap-right">

        <div class="olap-zones">

            <div>

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

            <div>

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

            <div>

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

            <div>

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

            <button
                type="button"
                data-template="orders"
            >
                🧾 По заказам
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

        container.appendChild(
            builder
        );

        setDefaultDates();

        bindOlapEvents();

        renderSelectedFields();
    }

    // ============================================================
    // DEFAULT DATES
    // ============================================================

    function setDefaultDates() {

        const today =
            todayString();

        const olapFrom =
            $("olap-from");

        const olapTo =
            $("olap-to");

        if (
            olapFrom &&
            !olapFrom.value
        ) {
            olapFrom.value =
                today;
        }

        if (
            olapTo &&
            !olapTo.value
        ) {
            olapTo.value =
                today;
        }

        const reportFrom =
            $("report-from");

        const reportTo =
            $("report-to");

        if (
            reportFrom &&
            !reportFrom.value
        ) {
            reportFrom.value =
                today;
        }

        if (
            reportTo &&
            !reportTo.value
        ) {
            reportTo.value =
                today;
        }
    }

    // ============================================================
    // OLAP EVENTS
    // ============================================================

    function bindOlapEvents() {

        const fieldsContainer =
            $("olap-fields");

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
                        item.style.opacity =
                            "";
                    }
                }
            );
        }

        document
            .querySelectorAll(
                "#olap-builder .olap-dropzone"
            )
            .forEach(function (zone) {

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
            });

        const search =
            $("olap-search");

        if (search) {

            search.addEventListener(
                "input",
                renderOlapFields
            );
        }

        const run =
            $("olap-run");

        if (run) {

            run.addEventListener(
                "click",
                runOlapReport
            );
        }

        const clear =
            $("olap-clear");

        if (clear) {

            clear.addEventListener(
                "click",
                clearOlapConstructor
            );
        }

        document
            .querySelectorAll(
                "#olap-builder [data-template]"
            )
            .forEach(function (button) {

                button.addEventListener(
                    "click",
                    function () {

                        applyQuickTemplate(
                            button.dataset.template
                        );
                    }
                );
            });
    }

    // ============================================================
    // LOAD OLAP FIELDS
    // ============================================================

    async function loadOlapFields() {

        if (!iikoConnection) {
            return;
        }

        const status =
            $("olap-status");

        if (status) {
            status.textContent =
                "⏳ Загружаем реальные поля OLAP из iiko...";
        }

        const container =
            $("olap-fields");

        if (container) {

            container.innerHTML = `
                <div class="olap-loading">
                    ⏳ Получаем структуру OLAP...
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
                "================================"
            );

            console.log(
                "IIKO OLAP FIELDS RESPONSE:"
            );

            console.log(
                data
            );

            console.log(
                "================================"
            );

            if (
                !response.ok ||
                data.success === false
            ) {
                throw new Error(
                    data.message ||
                    "Не удалось загрузить поля OLAP"
                );
            }

            olapFields =
                extractOlapFields(
                    data
                );

            console.log(
                "EXTRACTED OLAP FIELDS:",
                olapFields
            );

            renderOlapFields();

            if (!olapFields.length) {

                if (status) {

                    status.innerHTML =
                        "🔴 iiko ответил, но поля не найдены.";
                }

                if (container) {

                    container.innerHTML = `
                        <div class="olap-error">

                            <strong>
                                Поля OLAP не найдены
                            </strong>

                            <br><br>

                            iiko ответил успешно,
                            но структура ответа не содержит
                            распознанных полей.

                            <div class="olap-debug">

                                Откройте Console браузера
                                и найдите:

                                <br><br>

                                <b>
                                    IIKO OLAP FIELDS RESPONSE
                                </b>

                            </div>

                        </div>
                    `;
                }

                return;
            }

            if (status) {

                status.textContent =
                    `🟢 Загружено полей OLAP: ${olapFields.length}`;
            }

        } catch (error) {

            console.error(
                "OLAP FIELDS ERROR:",
                error
            );

            if (status) {

                status.textContent =
                    "🔴 " +
                    error.message;
            }

            if (container) {

                container.innerHTML = `
                    <div class="olap-error">

                        🔴 ${escapeHtml(
                            error.message
                        )}

                    </div>
                `;
            }
        }
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
            forcedMeasure = false
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
                    title: name,
                    type: "unknown",
                    isMeasure:
                        forcedMeasure,
                    aggregations:
                        forcedMeasure
                            ? [
                                "SUM",
                                "COUNT",
                                "COUNT_DISTINCT",
                                "AVG",
                                "MIN",
                                "MAX"
                            ]
                            : [
                                "COUNT",
                                "COUNT_DISTINCT"
                            ]
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

            const title =
                raw.title ||
                raw.caption ||
                raw.label ||
                raw.displayName ||
                raw.description ||
                raw.name ||
                raw.field ||
                name;

            if (!name) {
                return;
            }

            const type =
                String(
                    raw.type ||
                    raw.dataType ||
                    raw.kind ||
                    raw.fieldType ||
                    raw.valueType ||
                    ""
                );

            const lower =
                (
                    type +
                    " " +
                    String(
                        raw.name ||
                        ""
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
                lower.includes("number") ||
                lower.includes("numeric") ||
                lower.includes("decimal") ||
                lower.includes("double") ||
                lower.includes("float") ||
                lower.includes("integer") ||
                lower.includes("money") ||
                lower.includes("currency") ||
                lower.includes("measure");

            const isMeasure =
                forcedMeasure ||
                explicitMeasure ||
                aggregationAllowed ||
                numeric;

            let aggregations = [];

            if (
                Array.isArray(
                    raw.aggregations
                )
            ) {
                aggregations =
                    raw.aggregations
                        .map(
                            x =>
                                String(x)
                                    .toUpperCase()
                        )
                        .filter(Boolean);
            }

            if (
                !aggregations.length &&
                Array.isArray(
                    raw.allowedAggregations
                )
            ) {
                aggregations =
                    raw.allowedAggregations
                        .map(
                            x =>
                                String(x)
                                    .toUpperCase()
                        )
                        .filter(Boolean);
            }

            if (
                !aggregations.length
            ) {
                aggregations =
                    isMeasure
                        ? [
                            "SUM",
                            "COUNT",
                            "COUNT_DISTINCT",
                            "AVG",
                            "MIN",
                            "MAX"
                        ]
                        : [
                            "COUNT",
                            "COUNT_DISTINCT"
                        ];
            }

            result.push({
                ...raw,

                name:
                    String(name),

                title:
                    String(title),

                type,

                isMeasure,

                aggregations
            });
        }

        function scan(
            value,
            context = "dimension"
        ) {

            if (
                value === null ||
                value === undefined
            ) {
                return;
            }

            if (
                typeof value === "string"
            ) {
                return;
            }

            if (!isObject(value)) {
                return;
            }

            if (visited.has(value)) {
                return;
            }

            visited.add(value);

            if (Array.isArray(value)) {

                value.forEach(
                    item =>
                        scan(
                            item,
                            context
                        )
                );

                return;
            }

            dimensionKeys.forEach(
                key => {

                    if (
                        Array.isArray(
                            value[key]
                        )
                    ) {

                        value[key].forEach(
                            item =>
                                addField(
                                    item,
                                    false
                                )
                        );
                    }
                }
            );

            measureKeys.forEach(
                key => {

                    if (
                        Array.isArray(
                            value[key]
                        )
                    ) {

                        value[key].forEach(
                            item =>
                                addField(
                                    item,
                                    true
                                )
                        );
                    }
                }
            );

            fieldKeys.forEach(
                key => {

                    if (
                        Array.isArray(
                            value[key]
                        )
                    ) {

                        value[key].forEach(
                            item =>
                                addField(
                                    item,
                                    context ===
                                    "measure"
                                )
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
                    key => {

                        const child =
                            value[key];

                        if (
                            child === null ||
                            child === undefined
                        ) {
                            return;
                        }

                        const keyLower =
                            key.toLowerCase();

                        let childContext =
                            context;

                        if (
                            measureKeys.includes(
                                key
                            ) ||
                            keyLower.includes(
                                "measure"
                            ) ||
                            keyLower.includes(
                                "metric"
                            )
                        ) {
                            childContext =
                                "measure";
                        }

                        if (
                            dimensionKeys.includes(
                                key
                            ) ||
                            keyLower.includes(
                                "dimension"
                            )
                        ) {
                            childContext =
                                "dimension";
                        }

                        if (
                            typeof child ===
                            "object"
                        ) {

                            scan(
                                child,
                                childContext
                            );
                        }
                    }
                );
        }

        scan(
            data,
            "dimension"
        );

        // ========================================================
        // UNIQUE
        // ========================================================

        const unique =
            new Map();

        result.forEach(
            field => {

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

                const old =
                    unique.get(name);

                if (!old) {

                    unique.set(
                        name,
                        {
                            ...field,
                            name
                        }
                    );

                } else {

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
                                ),

                            aggregations:
                                field.aggregations?.length
                                    ? field.aggregations
                                    : old.aggregations
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
    // FIELD AGGREGATIONS
    // ============================================================

    function getAllowedAggregations(field) {

        if (
            field &&
            Array.isArray(
                field.aggregations
            ) &&
            field.aggregations.length
        ) {
            return field.aggregations;
        }

        if (
            field &&
            field.isMeasure
        ) {
            return [
                "SUM",
                "COUNT",
                "COUNT_DISTINCT",
                "AVG",
                "MIN",
                "MAX"
            ];
        }

        return [
            "COUNT",
            "COUNT_DISTINCT"
        ];
    }

    function getDefaultAggregation(field) {

        const allowed =
            getAllowedAggregations(
                field
            );

        if (
            allowed.includes("SUM")
        ) {
            return "SUM";
        }

        if (
            allowed.includes(
                "COUNT_DISTINCT"
            )
        ) {
            return "COUNT_DISTINCT";
        }

        return "COUNT";
    }

    // ============================================================
    // FILTER OPERATORS
    // ============================================================

    function getFilterOperators(field) {

        const type =
            String(
                field?.type ||
                ""
            ).toLowerCase();

        const name =
            String(
                field?.name ||
                ""
            ).toLowerCase();

        const dateLike =
            /date|time/.test(
                type + name
            );

        const numeric =
            /number|numeric|decimal|double|float|integer|money|currency/.test(
                type
            );

        if (
            dateLike ||
            numeric
        ) {
            return [
                "=",
                "!=",
                ">=",
                "<=",
                ">",
                "<",
                "BETWEEN"
            ];
        }

        return [
            "=",
            "!=",
            "CONTAINS",
            "STARTS_WITH",
            "ENDS_WITH",
            "IN"
        ];
    }

    function filterOperatorTitle(
        operator
    ) {

        const titles = {

            "=":
                "=",

            "!=":
                "≠",

            ">=":
                "≥",

            "<=":
                "≤",

            ">":
                ">",

            "<":
                "<",

            BETWEEN:
                "Между",

            CONTAINS:
                "Содержит",

            STARTS_WITH:
                "Начинается с",

            ENDS_WITH:
                "Заканчивается",

            IN:
                "В списке"
        };

        return (
            titles[operator] ||
            operator
        );
    }

    // ============================================================
    // RENDER AVAILABLE FIELDS
    // ============================================================

    function renderOlapFields() {

        const container =
            $("olap-fields");

        if (!container) {
            return;
        }

        const search =
            $("olap-search")
                ?.value
                .trim()
                .toLowerCase() || "";

        const filtered =
            olapFields.filter(
                field => {

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
            $("olap-field-count");

        if (count) {

            count.textContent =
                `${filtered.length}/${olapFields.length}`;
        }

        if (!filtered.length) {

            container.innerHTML = `
                <div class="olap-empty">
                    ${
                        olapFields.length
                            ? "Ничего не найдено"
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

                button.type = "button";

                button.className =
                    "olap-field";

                button.draggable = true;

                button.dataset.field =
                    field.name;

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

                    <span>
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
    // SELECTED FIELD HELPERS
    // ============================================================

    function findSelectedField(
        name
    ) {

        return [
            ...olapRows,
            ...olapColumns,
            ...olapMeasures,
            ...olapFilters
        ].find(
            field =>
                field.name === name
        );
    }

    function removeFromAllGroups(
        name
    ) {

        olapRows =
            olapRows.filter(
                field =>
                    field.name !== name
            );

        olapColumns =
            olapColumns.filter(
                field =>
                    field.name !== name
            );

        olapMeasures =
            olapMeasures.filter(
                field =>
                    field.name !== name
            );

        olapFilters =
            olapFilters.filter(
                field =>
                    field.name !== name
            );
    }

    // ============================================================
    // MOVE FIELD
    // ============================================================

    function moveOlapField(
        name,
        zone
    ) {

        const field =
            olapFields.find(
                item =>
                    item.name === name
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
                previous?.aggregation ||
                getDefaultAggregation(
                    field
                ),

            operator:
                previous?.operator ||
                "=",

            value:
                previous?.value ??
                ""
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
    // RENDER SELECTED
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
            $(elementId);

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

            container.innerHTML = `
                <div class="olap-empty">
                    ${messages[group]}
                </div>
            `;

            return;
        }

        container.innerHTML = "";

        fields.forEach(
            function (field) {

                const chip =
                    document.createElement(
                        "div"
                    );

                chip.className =
                    "olap-chip";

                chip.draggable = true;

                chip.dataset.field =
                    field.name;

                let controls = "";

                // ------------------------------------------------
                // MEASURE
                // ------------------------------------------------

                if (
                    group === "measures"
                ) {

                    const allowed =
                        getAllowedAggregations(
                            field
                        );

                    controls = `

                        <select
                            class="olap-aggregation"
                            title="Агрегация"
                        >

                            ${
                                allowed
                                    .map(
                                        aggregation =>
                                            `
                                            <option
                                                value="${escapeHtml(
                                                    aggregation
                                                )}"
                                                ${
                                                    field.aggregation ===
                                                    aggregation
                                                        ? "selected"
                                                        : ""
                                                }
                                            >
                                                ${escapeHtml(
                                                    aggregation
                                                )}
                                            </option>
                                            `
                                    )
                                    .join("")
                            }

                        </select>
                    `;
                }

                // ------------------------------------------------
                // FILTER
                // ------------------------------------------------

                if (
                    group === "filters"
                ) {

                    const operators =
                        getFilterOperators(
                            field
                        );

                    controls = `

                        <span class="olap-filter-controls">

                            <select
                                class="olap-filter-operator"
                            >

                                ${
                                    operators
                                        .map(
                                            operator =>
                                                `
                                                <option
                                                    value="${escapeHtml(
                                                        operator
                                                    )}"
                                                    ${
                                                        field.operator ===
                                                        operator
                                                            ? "selected"
                                                            : ""
                                                    }
                                                >
                                                    ${escapeHtml(
                                                        filterOperatorTitle(
                                                            operator
                                                        )
                                                    )}
                                                </option>
                                                `
                                        )
                                        .join("")
                                }

                            </select>

                            <input
                                class="olap-filter-value"
                                value="${escapeHtml(
                                    field.value
                                )}"
                                placeholder="Значение..."
                            >

                        </span>
                    `;
                }

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

                    ${controls}

                    <button
                        type="button"
                        class="olap-remove"
                        title="Удалить"
                    >
                        ×
                    </button>
                `;

                // ------------------------------------------------
                // DRAG
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
                // REMOVE
                // ------------------------------------------------

                const remove =
                    chip.querySelector(
                        ".olap-remove"
                    );

                if (remove) {

                    remove.addEventListener(
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
                // AGGREGATION
                // ------------------------------------------------

                const aggregation =
                    chip.querySelector(
                        ".olap-aggregation"
                    );

                if (aggregation) {

                    aggregation.addEventListener(
                        "change",
                        function () {

                            field.aggregation =
                                aggregation.value;
                        }
                    );
                }

                // ------------------------------------------------
                // FILTER OPERATOR
                // ------------------------------------------------

                const operator =
                    chip.querySelector(
                        ".olap-filter-operator"
                    );

                if (operator) {

                    operator.addEventListener(
                        "change",
                        function () {

                            field.operator =
                                operator.value;
                        }
                    );
                }

                // ------------------------------------------------
                // FILTER VALUE
                // ------------------------------------------------

                const value =
                    chip.querySelector(
                        ".olap-filter-value"
                    );

                if (value) {

                    value.addEventListener(
                        "input",
                        function () {

                            field.value =
                                value.value;
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
                ([id, value]) => {

                    const element =
                        $(id);

                    if (element) {
                        element.textContent =
                            value;
                    }
                }
            );
    }

    // ============================================================
    // CLEAR OLAP
    // ============================================================

    function clearOlapConstructor() {

        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];

        const result =
            $("olap-result");

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
            Array.from(
                arguments
            ).map(
                value =>
                    String(value)
                        .toLowerCase()
            );

        return olapFields.find(
            field => {

                const name =
                    String(
                        field.name ||
                        ""
                    ).toLowerCase();

                const title =
                    String(
                        field.title ||
                        ""
                    ).toLowerCase();

                return names.some(
                    search =>
                        name === search ||
                        title === search ||
                        name.includes(search) ||
                        title.includes(search)
                );
            }
        );
    }

    // ============================================================
    // QUICK TEMPLATES
    // ============================================================

    function applyQuickTemplate(
        type
    ) {

        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];

        const date =
            findOlapField(
                "OpenDate.Typed",
                "OpenDate",
                "Учетный день",
                "Дата открытия",
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

        const orderAggregation =
            orders &&
            getAllowedAggregations(
                orders
            ).includes(
                "COUNT_DISTINCT"
            )
                ? "COUNT_DISTINCT"
                : "COUNT";

        if (
            type === "sales"
        ) {

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
                    aggregation:
                        orderAggregation
                });
            }
        }

        if (
            type === "daily"
        ) {

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

        if (
            type === "dish"
        ) {

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
                    aggregation:
                        orderAggregation
                });
            }
        }

        if (
            type === "department"
        ) {

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
                    aggregation:
                        orderAggregation
                });
            }
        }

        if (
            type === "orders"
        ) {

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
    // BUILD OLAP PAYLOAD
    // ============================================================

    function buildOlapPayload(
        from,
        to
    ) {

        const payload = {

            action:
                "query",

            reportType:
                "SALES",

            ip:
                iikoConnection.ip,

            port:
                iikoConnection.port,

            login:
                iikoConnection.login,

            password:
                iikoConnection.password,

            from,
            to,

            rows:
                olapRows.map(
                    field =>
                        field.name
                ),

            columns:
                olapColumns.map(
                    field =>
                        field.name
                ),

            measures:
                olapMeasures.map(
                    field => ({

                        field:
                            field.name,

                        aggregation:
                            field.aggregation ||
                            getDefaultAggregation(
                                field
                            )
                    })
                ),

            filters:
                olapFilters
                    .filter(
                        field =>
                            String(
                                field.value ??
                                ""
                            ).trim() !== ""
                    )
                    .map(
                        field => {

                            let value =
                                String(
                                    field.value
                                ).trim();

                            if (
                                field.operator ===
                                "IN"
                            ) {

                                value =
                                    value
                                        .split(",")
                                        .map(
                                            item =>
                                                item.trim()
                                        )
                                        .filter(
                                            Boolean
                                        );
                            }

                            if (
                                field.operator ===
                                "BETWEEN"
                            ) {

                                value =
                                    value
                                        .split(",")
                                        .map(
                                            item =>
                                                item.trim()
                                        )
                                        .filter(
                                            Boolean
                                        )
                                        .slice(
                                            0,
                                            2
                                        );
                            }

                            return {

                                field:
                                    field.name,

                                operator:
                                    field.operator ||
                                    "=",

                                value
                            };
                        }
                    )
        };

        return payload;
    }

    // ============================================================
    // RUN OLAP
    // ============================================================

    async function runOlapReport() {

        if (!iikoConnection) {

            showOlapError(
                "Сначала подключитесь к iiko Server"
            );

            return;
        }

        const from =
            $("olap-from")
                ?.value || "";

        const to =
            $("olap-to")
                ?.value || "";

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
                "Добавьте хотя бы одно поле"
            );

            return;
        }

        const emptyFilter =
            olapFilters.find(
                field =>
                    !String(
                        field.value ??
                        ""
                    ).trim()
            );

        if (emptyFilter) {

            showOlapError(
                `Укажите значение фильтра: ${
                    emptyFilter.title ||
                    emptyFilter.name
                }`
            );

            return;
        }

        const button =
            $("olap-run");

        const result =
            $("olap-result");

        if (button) {

            button.disabled = true;

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

        const payload =
            buildOlapPayload(
                from,
                to
            );

        console.log(
            "================================"
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
            "================================"
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

            showOlapError(
                error.message
            );

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

    function getReportRows(
        data
    ) {

        const variants = [

            data?.report?.data,

            data?.data?.data,

            data?.result?.data,

            data?.report,

            data?.data,

            data?.result
        ];

        for (
            const value of variants
        ) {

            if (
                Array.isArray(
                    value
                )
            ) {
                return value;
            }
        }

        if (
            data?.rawResponse
        ) {

            try {

                const raw =
                    typeof data.rawResponse ===
                    "string"
                        ? JSON.parse(
                            data.rawResponse
                        )
                        : data.rawResponse;

                return getReportRows(
                    raw
                );

            } catch (error) {

                console.warn(
                    "Ошибка rawResponse:",
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
            $("olap-result");

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
                    За выбранный период данных нет.
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

    function createResultTable(
        rows
    ) {

        const columns = [];

        rows.forEach(
            row => {

                if (
                    !row ||
                    typeof row !==
                    "object"
                ) {
                    return;
                }

                Object.keys(row)
                    .forEach(
                        key => {

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
            column => {

                const field =
                    olapFields.find(
                        item =>
                            item.name ===
                            column
                    );

                html += `

                    <th>
                        ${escapeHtml(
                            field?.title ||
                            column
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
            row => {

                html += "<tr>";

                columns.forEach(
                    column => {

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
    // FORMAT CELL
    // ============================================================

    function formatCell(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        if (
            typeof value ===
            "number"
        ) {
            return formatNumber(
                value
            );
        }

        if (
            typeof value ===
            "object"
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

    function showOlapError(
        message
    ) {

        const result =
            $("olap-result");

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
    // OLD SALES REPORT
    // ============================================================

    const loadSalesButton =
        $("load-sales");

    if (loadSalesButton) {

        loadSalesButton.addEventListener(
            "click",
            async function () {

                if (!iikoConnection) {

                    const result =
                        $("sales-result");

                    if (result) {

                        result.innerHTML = `

                            <div class="report-error">

                                ⚠️ Сначала подключитесь
                                к iiko Server

                            </div>
                        `;
                    }

                    return;
                }

                const from =
                    $("report-from")
                        ?.value || "";

                const to =
                    $("report-to")
                        ?.value || "";

                if (
                    !from ||
                    !to
                ) {

                    const result =
                        $("sales-result");

                    if (result) {

                        result.innerHTML = `

                            <div class="report-error">

                                ⚠️ Выберите период

                            </div>
                        `;
                    }

                    return;
                }

                if (from > to) {

                    const result =
                        $("sales-result");

                    if (result) {

                        result.innerHTML = `

                            <div class="report-error">

                                ⚠️ Неверный период

                            </div>
                        `;
                    }

                    return;
                }

                const result =
                    $("sales-result");

                loadSalesButton.disabled =
                    true;

                loadSalesButton.textContent =
                    "Загрузка...";

                if (result) {

                    result.innerHTML = `

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

                    if (result) {

                        result.innerHTML = `

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
    // SALES REPORT RENDER
    // ============================================================

    function renderSalesReport(
        data,
        from,
        to
    ) {

        const result =
            $("sales-result");

        if (!result) {
            return;
        }

        const rows =
            getReportRows(
                data
            );

        let totalSales = 0;

        const orderIds =
            new Set();

        rows.forEach(
            row => {

                if (
                    !row ||
                    typeof row !==
                    "object"
                ) {
                    return;
                }

                const salesValue =
                    row.DishSumInt ??
                    row.Revenue ??
                    row.Sales ??
                    0;

                totalSales +=
                    Number(
                        salesValue
                    ) || 0;

                const orderId =
                    row.UniqOrderId;

                if (
                    orderId !==
                    null &&
                    orderId !==
                    undefined &&
                    String(orderId)
                        .trim()
                ) {
                    orderIds.add(
                        String(
                            orderId
                        )
                    );
                }
            }
        );

        const explicitOrderCount =
            [
                data?.totalOrders,
                data?.orderCount,
                data?.report?.totalOrders,
                data?.report?.orderCount
            ]
                .map(Number)
                .find(
                    Number.isFinite
                );

        const totalOrders =
            explicitOrderCount !==
            undefined
                ? explicitOrderCount
                : orderIds.size;

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
                row => {

                    const sales =
                        Number(
                            row?.DishSumInt ??
                            row?.Revenue ??
                            row?.Sales ??
                            0
                        ) || 0;

                    const orderId =
                        row?.UniqOrderId;

                    const orders =
                        orderId !==
                            null &&
                        orderId !==
                            undefined
                            ? 1
                            : Number(
                                row?.OrderCount ??
                                row?.Orders ??
                                0
                            ) || 0;

                    const average =
                        orders
                            ? sales /
                                orders
                            : 0;

                    const date =
                        row?.[
                            "OpenDate.Typed"
                        ] ||
                        row?.OpenDate ||
                        row?.Date ||
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

        result.innerHTML =
            html;
    }

    // ============================================================
    // START
    // ============================================================

    setDefaultDates();

    loadSavedIikoData();

})();
