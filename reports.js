// ============================================================
// ANAR SYSTEM
// REPORTS + IIKO CONNECTION + OLAP CONSTRUCTOR
// reports.js
// ============================================================


// ============================================================
// GLOBAL HELPERS
// ============================================================

function getElement(id) {
    return document.getElementById(id);
}


// ============================================================
// SAFE JSON
// ============================================================

async function safeJson(response) {

    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (error) {

        console.error(
            "JSON PARSE ERROR:",
            text
        );

        throw new Error(
            `Сервер вернул некорректный ответ HTTP ${response.status}: ${text.slice(0, 500)}`
        );
    }
}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value) {

    return String(
        value === null ||
        value === undefined
            ? ""
            : value
    )
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ============================================================
// ELEMENTS
// ============================================================

const connectButton =
    getElement("connect-iiko");

const statusElement =
    getElement("iiko-status");

const salesCard =
    getElement("sales-card");

const loadSalesButton =
    getElement("load-sales");

const salesResult =
    getElement("sales-result");

const rememberIiko =
    getElement("remember-iiko");

const clearIikoData =
    getElement("clear-iiko-data");


// ============================================================
// IIKO STATE
// ============================================================

let iikoConnection = null;


// ============================================================
// STORAGE
// ============================================================

const IIKO_STORAGE_KEY =
    "iikoConnection";


// ============================================================
// OLAP STATE
// ============================================================

let olapFields = [];

let olapRows = [];

let olapColumns = [];

let olapMeasures = [];

let olapFilters = [];


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

        const data =
            JSON.parse(saved);

        const ip =
            getElement("iiko-ip");

        const port =
            getElement("iiko-port");

        const login =
            getElement("iiko-login");

        const password =
            getElement("iiko-password");

        if (ip) {
            ip.value =
                data.ip || "";
        }

        if (port) {
            port.value =
                data.port || "";
        }

        if (login) {
            login.value =
                data.login || "";
        }

        if (password) {
            password.value =
                data.password || "";
        }

        if (rememberIiko) {
            rememberIiko.checked = true;
        }

    } catch (error) {

        console.error(
            "Ошибка загрузки данных:",
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

    const ip =
        getElement("iiko-ip");

    const port =
        getElement("iiko-port");

    const login =
        getElement("iiko-login");

    const password =
        getElement("iiko-password");

    const data = {

        ip:
            ip
                ? ip.value.trim()
                : "",

        port:
            port
                ? port.value.trim()
                : "",

        login:
            login
                ? login.value.trim()
                : "",

        password:
            password
                ? password.value
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

if (clearIikoData) {

    clearIikoData.addEventListener(
        "click",
        function () {

            localStorage.removeItem(
                IIKO_STORAGE_KEY
            );

            const ip =
                getElement("iiko-ip");

            const port =
                getElement("iiko-port");

            const login =
                getElement("iiko-login");

            const password =
                getElement("iiko-password");

            if (ip) {
                ip.value = "";
            }

            if (port) {
                port.value = "";
            }

            if (login) {
                login.value = "";
            }

            if (password) {
                password.value = "";
            }

            if (rememberIiko) {
                rememberIiko.checked = false;
            }

            iikoConnection = null;

            if (salesCard) {
                salesCard.style.display =
                    "none";
            }

            if (statusElement) {
                statusElement.textContent =
                    "⚪ Данные удалены";
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
//
// ВАЖНО:
// Этот endpoint НЕ МЕНЯЕМ.
// Он остаётся:
// /api/iiko/connect
// ============================================================

if (connectButton) {

    connectButton.addEventListener(
        "click",
        async function () {

            const ip =
                getElement("iiko-ip")
                    ?.value
                    .trim();

            const port =
                getElement("iiko-port")
                    ?.value
                    .trim();

            const login =
                getElement("iiko-login")
                    ?.value
                    .trim();

            const password =
                getElement("iiko-password")
                    ?.value || "";


            if (
                !ip ||
                !port ||
                !login ||
                !password
            ) {

                if (statusElement) {
                    statusElement.textContent =
                        "⚠️ Заполните все поля";
                }

                return;
            }


            connectButton.disabled =
                true;

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
                    "IIKO CONNECT RESPONSE:",
                    data
                );


                if (
                    !response.ok ||
                    data.success === false
                ) {

                    throw new Error(
                        data.message ||
                        `Ошибка подключения iiko HTTP ${response.status}`
                    );
                }


                // ------------------------------------------
                // SAVE
                // ------------------------------------------

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


                // ------------------------------------------
                // CONNECTION STATE
                // ------------------------------------------

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


                // ------------------------------------------
                // CREATE OLAP BUILDER
                // ------------------------------------------

                createOlapBuilder();


                // ------------------------------------------
                // LOAD REAL OLAP FIELDS
                // ------------------------------------------

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

    if (
        getElement("olap-builder")
    ) {
        return;
    }


    const container =
        document.querySelector(
            ".reports-container"
        );


    if (!container) {
        return;
    }


    const builder =
        document.createElement(
            "div"
        );


    builder.id =
        "olap-builder";

    builder.className =
        "olap-builder";


    builder.innerHTML = `

        <style>

            #olap-builder {
                margin-top: 30px;
                padding: 0;
                border-radius: 16px;
                background: #fff;
                box-shadow:
                    0 10px 30px rgba(0,0,0,.08);
                overflow: hidden;
                color: #222;
            }

            #olap-builder * {
                box-sizing: border-box;
            }

            .olap-head {
                padding: 25px 30px 20px;
                border-bottom: 1px solid #eee;
            }

            .olap-head h2 {
                margin: 0;
                color: #222;
            }

            .olap-description {
                margin-top: 7px;
                color: #666;
                font-size: 14px;
            }

            .olap-status {
                padding: 13px 30px;
                background: #f7f7f7;
                color: #333;
                border-bottom: 1px solid #eee;
            }

            .olap-main {
                display: grid;
                grid-template-columns:
                    minmax(280px, .8fr)
                    minmax(450px, 1.5fr);
                min-height: 600px;
            }

            .olap-fields-panel {
                padding: 22px;
                border-right: 1px solid #eee;
                background: #fafafa;
            }

            .olap-builder-panel {
                padding: 22px;
            }

            .olap-panel-title {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                font-size: 13px;
                font-weight: 700;
                color: #222;
            }

            .olap-count {
                color: #888;
                font-size: 11px;
            }

            #olap-search {
                width: 100%;
                height: 44px;
                padding: 0 13px;
                border: 1px solid #ddd;
                border-radius: 9px;
                background: #fff;
                color: #222;
                font-size: 14px;
                outline: none;
            }

            #olap-search:focus {
                border-color: #aaa;
            }

            .olap-fields {
                display: flex;
                flex-direction: column;
                gap: 7px;
                max-height: 550px;
                overflow-y: auto;
                margin-top: 12px;
            }

            .olap-field {
                width: 100%;
                min-height: 52px;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border: 1px solid #ddd;
                border-radius: 9px;
                background: #fff;
                color: #222;
                text-align: left;
                cursor: grab;
            }

            .olap-field:hover {
                background: #f5f5f5;
            }

            .olap-field.dragging {
                opacity: .45;
            }

            .olap-field-icon {
                width: 30px;
                height: 30px;
                display: grid;
                place-items: center;
                flex-shrink: 0;
                border-radius: 7px;
                background: #f0f0f0;
            }

            .olap-field-text {
                min-width: 0;
                flex: 1;
            }

            .olap-field-text strong {
                display: block;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
            }

            .olap-field-text small {
                display: block;
                margin-top: 2px;
                color: #888;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 10px;
            }

            .olap-add-hint {
                color: #999;
                font-weight: 700;
            }

            .olap-zones {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 14px;
            }

            .olap-zone-title {
                display: flex;
                align-items: center;
                margin-bottom: 7px;
                font-size: 13px;
                font-weight: 700;
                color: #333;
            }

            .zone-count {
                margin-left: auto;
                color: #888;
                font-size: 11px;
            }

            .olap-dropzone {
                min-height: 115px;
                padding: 8px;
                border: 1.5px dashed #ccc;
                border-radius: 10px;
                background: #fafafa;
            }

            .olap-dropzone.is-over {
                border-color: #555;
                background: #f0f0f0;
            }

            .olap-dropzone.has-items {
                border-style: solid;
            }

            .olap-empty {
                min-height: 90px;
                display: grid;
                place-items: center;
                padding: 15px;
                color: #999;
                text-align: center;
                font-size: 12px;
                line-height: 1.5;
            }

            .olap-chip {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 45px;
                margin-bottom: 7px;
                padding: 7px 8px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background: #fff;
                cursor: grab;
            }

            .olap-chip:last-child {
                margin-bottom: 0;
            }

            .olap-chip.dragging {
                opacity: .45;
            }

            .olap-chip-text {
                min-width: 0;
                flex: 1;
            }

            .olap-chip-text strong {
                display: block;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 12px;
            }

            .olap-chip-text small {
                display: block;
                margin-top: 2px;
                color: #888;
                font-size: 10px;
            }

            .olap-remove {
                width: 28px;
                height: 28px;
                border: 0;
                border-radius: 6px;
                background: #f2f2f2;
                color: #777;
                cursor: pointer;
                font-size: 18px;
            }

            .olap-remove:hover {
                background: #eee;
                color: #222;
            }

            .olap-agg {
                height: 30px;
                border: 1px solid #ddd;
                border-radius: 6px;
                background: #fff;
                color: #333;
                font-size: 11px;
            }

            .olap-period {
                margin-top: 18px;
                padding: 18px;
                border: 1px solid #e5e5e5;
                border-radius: 10px;
                background: #fafafa;
            }

            .olap-period h3 {
                margin: 0 0 12px;
                font-size: 14px;
                color: #222;
            }

            .olap-period-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }

            .olap-period label {
                display: flex;
                flex-direction: column;
                color: #555;
                font-size: 11px;
                font-weight: 700;
            }

            .olap-period input {
                width: 100%;
                height: 40px;
                margin-top: 6px;
                padding: 0 9px;
                border: 1px solid #ddd;
                border-radius: 7px;
                background: #fff;
            }

            .olap-quick {
                display: flex;
                flex-wrap: wrap;
                gap: 7px;
                margin-top: 15px;
            }

            .olap-quick button {
                padding: 7px 10px;
                border: 1px solid #ddd;
                border-radius: 7px;
                background: #fff;
                color: #444;
                cursor: pointer;
            }

            .olap-quick button:hover {
                background: #f5f5f5;
            }

            .olap-actions {
                display: flex;
                gap: 10px;
                margin-top: 17px;
            }

            #olap-run {
                flex: 1;
                min-height: 47px;
                border: 0;
                border-radius: 8px;
                background: #222;
                color: #fff;
                cursor: pointer;
                font-weight: 700;
            }

            #olap-run:disabled {
                opacity: .6;
                cursor: wait;
            }

            #olap-clear {
                min-height: 47px;
                padding: 0 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background: #fff;
                color: #444;
                cursor: pointer;
            }

            .olap-result {
                padding: 25px 30px 30px;
                border-top: 1px solid #eee;
                background: #fafafa;
            }

            @media(max-width:900px) {

                .olap-main {
                    grid-template-columns: 1fr;
                }

                .olap-fields-panel {
                    border-right: 0;
                    border-bottom: 1px solid #eee;
                }

            }

            @media(max-width:650px) {

                .olap-zones {
                    grid-template-columns: 1fr;
                }

                .olap-period-grid {
                    grid-template-columns: 1fr;
                }

                .olap-actions {
                    flex-direction: column;
                }

            }

        </style>


        <div class="olap-head">

            <h2>
                🧩 Конструктор OLAP
            </h2>

            <div class="olap-description">
                Перетащите поля в Строки, Колонки,
                Показатели или Фильтры.
            </div>

        </div>


        <div
            id="olap-status"
            class="olap-status"
        >
            ⏳ Загрузка полей...
        </div>


        <div class="olap-main">


            <!-- AVAILABLE FIELDS -->

            <section
                class="olap-fields-panel"
            >

                <div class="olap-panel-title">

                    <span>
                        📚 Доступные поля
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
                    type="search"
                    placeholder="Поиск поля..."
                >


                <div
                    id="olap-fields"
                    class="olap-fields"
                >

                    <div class="olap-empty">
                        Загрузка...
                    </div>

                </div>

            </section>


            <!-- BUILDER -->

            <section
                class="olap-builder-panel"
            >


                <div class="olap-zones">


                    <div>

                        <div class="olap-zone-title">

                            ↕️ Строки

                            <span
                                id="olap-rows-count"
                                class="zone-count"
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

                            ↔️ Колонки

                            <span
                                id="olap-columns-count"
                                class="zone-count"
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
                                class="zone-count"
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
                                class="zone-count"
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


                <!-- PERIOD -->

                <div class="olap-period">

                    <h3>
                        📅 Период отчёта
                    </h3>


                    <div
                        class="olap-period-grid"
                    >

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


                <!-- QUICK -->

                <div class="olap-quick">

                    <button
                        type="button"
                        data-quick="sales"
                    >
                        💰 Продажи
                    </button>

                    <button
                        type="button"
                        data-quick="daily"
                    >
                        📅 По дням
                    </button>

                    <button
                        type="button"
                        data-quick="dish"
                    >
                        🍔 По блюдам
                    </button>

                    <button
                        type="button"
                        data-quick="department"
                    >
                        🏢 По подразделениям
                    </button>

                </div>


                <!-- ACTIONS -->

                <div class="olap-actions">

                    <button
                        type="button"
                        id="olap-clear"
                    >
                        Очистить
                    </button>


                    <button
                        type="button"
                        id="olap-run"
                    >
                        ▶️ Построить отчёт
                    </button>

                </div>


            </section>

        </div>


        <div
            id="olap-result"
            class="olap-result"
        ></div>

    `;


    container.appendChild(
        builder
    );


    setDefaultOlapDates();

    bindOlapDnD();

    renderSelectedOlapFields();


    const search =
        getElement(
            "olap-search"
        );

    if (search) {

        search.addEventListener(
            "input",
            renderOlapFields
        );
    }


    const run =
        getElement(
            "olap-run"
        );

    if (run) {

        run.addEventListener(
            "click",
            runOlapReport
        );
    }


    const clear =
        getElement(
            "olap-clear"
        );

    if (clear) {

        clear.addEventListener(
            "click",
            clearOlapConstructor
        );
    }


    document
        .querySelectorAll(
            "#olap-builder [data-quick]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    function () {

                        applyQuickOlapTemplate(
                            button.dataset.quick
                        );

                    }
                );

            }
        );
}


// ============================================================
// DRAG & DROP
// ============================================================

function bindOlapDnD() {

    const fieldsContainer =
        getElement(
            "olap-fields"
        );

    if (!fieldsContainer) {
        return;
    }


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


            const field =
                olapFields.find(
                    x =>
                        x.name ===
                        item.dataset.field
                );


            if (!field) {
                return;
            }


            event.dataTransfer.effectAllowed =
                "copyMove";

            event.dataTransfer.setData(
                "application/x-olap-field",
                field.name
            );


            item.classList.add(
                "dragging"
            );
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

                item.classList.remove(
                    "dragging"
                );
            }
        }
    );


    document
        .querySelectorAll(
            "#olap-builder .olap-dropzone"
        )
        .forEach(
            zone => {

                zone.addEventListener(
                    "dragover",
                    function (event) {

                        event.preventDefault();

                        event.dataTransfer.dropEffect =
                            "move";

                        zone.classList.add(
                            "is-over"
                        );
                    }
                );


                zone.addEventListener(
                    "dragleave",
                    function (event) {

                        if (
                            !zone.contains(
                                event.relatedTarget
                            )
                        ) {

                            zone.classList.remove(
                                "is-over"
                            );
                        }
                    }
                );


                zone.addEventListener(
                    "drop",
                    function (event) {

                        event.preventDefault();

                        zone.classList.remove(
                            "is-over"
                        );


                        const name =
                            event.dataTransfer.getData(
                                "application/x-olap-field"
                            );


                        if (name) {

                            moveOlapField(
                                name,
                                zone.dataset.zone
                            );
                        }
                    }
                );

            }
        );
}


// ============================================================
// OLAP STATE
// ============================================================

function allOlapSelected() {

    return [

        ...olapRows,

        ...olapColumns,

        ...olapMeasures,

        ...olapFilters

    ];
}


// ============================================================
// REMOVE FIELD
// ============================================================

function removeFromAllOlapGroups(
    name
) {

    olapRows =
        olapRows.filter(
            x =>
                x.name !== name
        );

    olapColumns =
        olapColumns.filter(
            x =>
                x.name !== name
        );

    olapMeasures =
        olapMeasures.filter(
            x =>
                x.name !== name
        );

    olapFilters =
        olapFilters.filter(
            x =>
                x.name !== name
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
            x =>
                x.name === name
        );


    if (!field) {
        return;
    }


    const oldMeasure =
        olapMeasures.find(
            x =>
                x.name === name
        );


    removeFromAllOlapGroups(
        name
    );


    const copy = {

        ...field,

        aggregation:
            oldMeasure?.aggregation ||
            getMeasureAggregation(
                field
            )
    };


    if (zone === "rows") {

        olapRows.push(
            copy
        );
    }


    if (zone === "columns") {

        olapColumns.push(
            copy
        );
    }


    if (zone === "filters") {

        olapFilters.push(
            copy
        );
    }


    if (zone === "measures") {

        olapMeasures.push(
            copy
        );
    }


    renderSelectedOlapFields();
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
        getElement(
            "olap-result"
        );

    if (result) {

        result.innerHTML =
            "";
    }


    renderSelectedOlapFields();
}


// ============================================================
// DEFAULT DATES
// ============================================================

function setDefaultOlapDates() {

    const from =
        getElement(
            "olap-from"
        );

    const to =
        getElement(
            "olap-to"
        );


    if (!from || !to) {
        return;
    }


    const now =
        new Date();


    const yyyy =
        now.getFullYear();

    const mm =
        String(
            now.getMonth() + 1
        )
            .padStart(
                2,
                "0"
            );

    const dd =
        String(
            now.getDate()
        )
            .padStart(
                2,
                "0"
            );


    const today =
        `${yyyy}-${mm}-${dd}`;


    if (!from.value) {

        from.value =
            today;
    }


    if (!to.value) {

        to.value =
            today;
    }


    const salesFrom =
        getElement(
            "report-from"
        );

    const salesTo =
        getElement(
            "report-to"
        );


    if (
        salesFrom &&
        !salesFrom.value
    ) {

        salesFrom.value =
            today;
    }


    if (
        salesTo &&
        !salesTo.value
    ) {

        salesTo.value =
            today;
    }
}


// ============================================================
// LOAD REAL OLAP FIELDS
//
// ГЛАВНОЕ ИСПРАВЛЕНИЕ:
//
// БЫЛО:
// /api/iiko/olap/fields
//
// СТАЛО:
// /api/iiko/olap
// action: "fields"
// ============================================================

async function loadOlapFields() {

    if (!iikoConnection) {
        return;
    }


    const status =
        getElement(
            "olap-status"
        );

    const container =
        getElement(
            "olap-fields"
        );


    if (status) {

        status.textContent =
            "⏳ Получаем реальные поля OLAP из iiko...";
    }


    if (container) {

        container.innerHTML =
            `
            <div class="olap-empty">
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
                            "application/json",

                        "Accept":
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
                `Ошибка OLAP HTTP ${response.status}`
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


        if (
            !olapFields.length
        ) {

            if (status) {

                status.innerHTML =
                    "🔴 iiko ответил, " +
                    "но поля OLAP не найдены.";
            }


            if (container) {

                container.innerHTML =
                    `
                    <div class="olap-empty">

                        Поля OLAP не найдены.

                        <br><br>

                        Проверьте Console браузера:
                        <br>
                        <b>IIKO OLAP FIELDS RESPONSE</b>

                    </div>
                    `;
            }

            return;
        }


        if (status) {

            status.textContent =
                `🟢 Доступные поля OLAP: ${olapFields.length}`;
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

            container.innerHTML =
                `
                <div class="report-error">

                    🔴
                    ${escapeHtml(
                        error.message
                    )}

                </div>
                `;
        }
    }
}


// ============================================================
// EXTRACT OLAP FIELDS
//
// Поддерживаем:
// data.fields
// data.data
// data.raw
// arrays
// objects
// nested fields
// ============================================================

function extractOlapFields(
    data
) {

    const result = [];

    const seen =
        new Set();


    function addField(
        field,
        fallbackName = "",
        forcedMeasure = false
    ) {

        if (
            field === null ||
            field === undefined
        ) {
            return;
        }


        let name = "";

        let title = "";

        let type = "";


        if (
            typeof field === "string"
        ) {

            name =
                field.trim();

            title =
                name;

        } else if (
            typeof field === "object"
        ) {

            name =
                field.name ||
                field.field ||
                field.key ||
                field.id ||
                field.code ||
                field.technicalName ||
                field.uniqueName ||
                field.dataField ||
                fallbackName ||
                "";


            title =
                field.title ||
                field.caption ||
                field.label ||
                field.displayName ||
                field.description ||
                field.name ||
                name;


            type =
                field.type ||
                field.dataType ||
                field.kind ||
                field.fieldType ||
                field.valueType ||
                "";
        }


        name =
            String(
                name || ""
            ).trim();


        if (!name) {
            return;
        }


        const key =
            name.toLowerCase();


        if (
            seen.has(key)
        ) {
            return;
        }


        seen.add(key);


        const objectField =
            (
                field &&
                typeof field === "object"
            )
                ? field
                : {};


        const lowerType =
            String(
                type
            )
                .toLowerCase();


        const aggregationAllowed =
            objectField.aggregationAllowed === true ||
            objectField.allowAggregation === true ||
            objectField.canAggregate === true;


        const isMeasure =
            Boolean(

                forcedMeasure ||

                objectField.isMeasure === true ||

                objectField.measure === true ||

                objectField.is_metric === true ||

                aggregationAllowed ||

                lowerType.includes(
                    "measure"
                ) ||

                lowerType.includes(
                    "numeric"
                ) ||

                lowerType.includes(
                    "number"
                ) ||

                lowerType.includes(
                    "decimal"
                ) ||

                lowerType.includes(
                    "money"
                )
            );


        result.push({

            ...objectField,

            name,

            field:
                name,

            key:
                name,

            title:
                String(
                    title ||
                    name
                ),

            type:
                String(
                    type ||
                    ""
                ),

            isMeasure,

            aggregationAllowed,

            groupingAllowed:
                objectField.groupingAllowed !== false,

            filteringAllowed:
                objectField.filteringAllowed !== false
        });
    }


    function parseArray(
        array,
        forcedMeasure = false
    ) {

        if (
            !Array.isArray(array)
        ) {
            return;
        }


        array.forEach(
            item => {

                addField(
                    item,
                    "",
                    forcedMeasure
                );
            }
        );
    }


    function parseObject(
        object
    ) {

        if (
            !object ||
            typeof object !== "object" ||
            Array.isArray(object)
        ) {
            return;
        }


        Object.entries(
            object
        )
            .forEach(
                ([key, value]) => {

                    if (
                        [
                            "success",
                            "count",
                            "action",
                            "reportType",
                            "raw",
                            "message"
                        ].includes(
                            key
                        )
                    ) {
                        return;
                    }


                    if (
                        key === "dimensions" ||
                        key === "dimension"
                    ) {

                        if (
                            Array.isArray(value)
                        ) {

                            parseArray(
                                value,
                                false
                            );
                        }

                        return;
                    }


                    if (
                        key === "measures" ||
                        key === "measure" ||
                        key === "metrics"
                    ) {

                        if (
                            Array.isArray(value)
                        ) {

                            parseArray(
                                value,
                                true
                            );
                        }

                        return;
                    }


                    if (
                        key === "fields" ||
                        key === "columns" ||
                        key === "items" ||
                        key === "fieldDefinitions" ||
                        key === "availableFields"
                    ) {

                        if (
                            Array.isArray(value)
                        ) {

                            parseArray(
                                value
                            );

                        } else if (
                            value &&
                            typeof value === "object"
                        ) {

                            parseObject(
                                value
                            );
                        }

                        return;
                    }


                    if (
                        value &&
                        typeof value === "object"
                    ) {

                        if (
                            !Array.isArray(value)
                        ) {

                            addField(
                                value,
                                key
                            );

                        } else {

                            parseArray(
                                value
                            );
                        }
                    }
                }
            );
    }


    if (!data) {
        return [];
    }


    // ------------------------------------------
    // backend fields
    // ------------------------------------------

    if (
        Array.isArray(
            data.fields
        )
    ) {

        parseArray(
            data.fields
        );

    } else if (
        data.fields &&
        typeof data.fields === "object"
    ) {

        parseObject(
            data.fields
        );
    }


    // ------------------------------------------
    // backend raw
    // ------------------------------------------

    if (
        data.raw
    ) {

        if (
            Array.isArray(
                data.raw
            )
        ) {

            parseArray(
                data.raw
            );

        } else if (
            typeof data.raw === "object"
        ) {

            parseObject(
                data.raw
            );
        }
    }


    // ------------------------------------------
    // data
    // ------------------------------------------

    if (
        data.data
    ) {

        if (
            Array.isArray(
                data.data
            )
        ) {

            parseArray(
                data.data
            );

        } else if (
            typeof data.data === "object"
        ) {

            parseObject(
                data.data
            );
        }
    }


    // ------------------------------------------
    // direct object
    // ------------------------------------------

    if (
        result.length === 0 &&
        typeof data === "object"
    ) {

        parseObject(
            data
        );
    }


    return result;
}


// ============================================================
// RENDER AVAILABLE FIELDS
// ============================================================

function renderOlapFields() {

    const container =
        getElement(
            "olap-fields"
        );


    if (!container) {
        return;
    }


    const searchInput =
        getElement(
            "olap-search"
        );


    const search =
        searchInput
            ? searchInput.value
                .trim()
                .toLowerCase()
            : "";


    const filtered =
        olapFields.filter(
            field => {

                const text =
                    `${field.name} ${field.title} ${field.type}`
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


    if (
        !filtered.length
    ) {

        container.innerHTML =
            `
            <div class="olap-empty">

                ${
                    olapFields.length
                        ? "По вашему запросу ничего не найдено"
                        : "Поля не найдены"
                }

            </div>
            `;

        return;
    }


    container.innerHTML =
        "";


    filtered.forEach(
        field => {

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
                "Перетащите поле в нужную область " +
                "или нажмите для добавления";


            button.innerHTML =
                `

                <span class="olap-field-icon">

                    ${
                        field.isMeasure
                            ? "📊"
                            : "▤"
                    }

                </span>


                <span class="olap-field-text">

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

                        ${
                            field.type
                                ? " • " +
                                  escapeHtml(
                                      field.type
                                  )
                                : ""
                        }

                    </small>

                </span>


                <span class="olap-add-hint">
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
// MEASURE AGGREGATION
// ============================================================

function getMeasureAggregation(
    field
) {

    if (
        field &&
        field.aggregation
    ) {

        return field.aggregation;
    }


    return "SUM";
}


// ============================================================
// RENDER SELECTED
// ============================================================

function renderSelectedOlapFields() {

    renderSelectedGroup(
        "olap-rows",
        olapRows,
        "rows"
    );


    renderSelectedGroup(
        "olap-columns",
        olapColumns,
        "columns"
    );


    renderSelectedGroup(
        "olap-measures",
        olapMeasures,
        "measures"
    );


    renderSelectedGroup(
        "olap-filters",
        olapFilters,
        "filters"
    );


    updateOlapCounts();
}


// ============================================================
// COUNTS
// ============================================================

function updateOlapCounts() {

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


    Object.entries(
        values
    )
        .forEach(
            ([id, value]) => {

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
// RENDER GROUP
// ============================================================

function renderSelectedGroup(
    elementId,
    fields,
    group
) {

    const container =
        getElement(
            elementId
        );


    if (!container) {
        return;
    }


    if (
        !fields.length
    ) {

        const text = {

            rows:
                "Перетащите сюда поля, " +
                "по которым будут строки отчёта",

            columns:
                "Перетащите сюда поле для колонок",

            measures:
                "Перетащите сюда числовые поля",

            filters:
                "Перетащите сюда поля-фильтры"

        }[group];


        container.classList.remove(
            "has-items"
        );


        container.innerHTML =
            `
            <div class="olap-empty">
                ${text}
            </div>
            `;

        return;
    }


    container.classList.add(
        "has-items"
    );


    container.innerHTML =
        "";


    fields.forEach(
        field => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "olap-chip";

            item.draggable =
                true;

            item.dataset.field =
                field.name;


            const aggregation =
                group === "measures"
                    ? (
                        field.aggregation ||
                        "SUM"
                    )
                    : "";


            item.innerHTML =
                `

                <span class="olap-field-icon">

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

                        ${
                            aggregation
                                ? " • " +
                                  aggregation
                                : ""
                        }

                    </small>

                </span>


                ${
                    group === "measures"
                        ? `

                            <select
                                class="olap-agg"
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


            // ------------------------------------------
            // DRAG SELECTED FIELD
            // ------------------------------------------

            item.addEventListener(
                "dragstart",
                function (event) {

                    event.stopPropagation();

                    event.dataTransfer.effectAllowed =
                        "move";

                    event.dataTransfer.setData(
                        "application/x-olap-field",
                        field.name
                    );

                    item.classList.add(
                        "dragging"
                    );
                }
            );


            item.addEventListener(
                "dragend",
                function () {

                    item.classList.remove(
                        "dragging"
                    );
                }
            );


            // ------------------------------------------
            // REMOVE
            // ------------------------------------------

            const remove =
                item.querySelector(
                    ".olap-remove"
                );


            if (remove) {

                remove.addEventListener(
                    "click",
                    function (event) {

                        event.stopPropagation();

                        removeFromAllOlapGroups(
                            field.name
                        );

                        renderSelectedOlapFields();
                    }
                );
            }


            // ------------------------------------------
            // AGGREGATION
            // ------------------------------------------

            const agg =
                item.querySelector(
                    ".olap-agg"
                );


            if (agg) {

                agg.addEventListener(
                    "change",
                    function (event) {

                        field.aggregation =
                            event.target.value;

                        renderSelectedOlapFields();
                    }
                );
            }


            container.appendChild(
                item
            );
        }
    );
}


// ============================================================
// FIND FIELD
// ============================================================

function findOlapField(
    ...names
) {

    return olapFields.find(
        field => {

            const name =
                String(
                    field.name || ""
                )
                    .toLowerCase();

            const title =
                String(
                    field.title || ""
                )
                    .toLowerCase();


            return names.some(
                search => {

                    const value =
                        String(
                            search
                        )
                            .toLowerCase();


                    return (

                        name === value ||

                        title === value ||

                        name.includes(value) ||

                        title.includes(value)

                    );
                }
            );
        }
    );
}


// ============================================================
// QUICK TEMPLATES
// ============================================================

function applyQuickOlapTemplate(
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
            "Дата открытия",
            "Учетный день"
        );


    const dish =
        findOlapField(
            "DishName",
            "Блюдо",
            "Dish"
        );


    const department =
        findOlapField(
            "Department",
            "Подразделение",
            "Department.Id"
        );


    const sales =
        findOlapField(
            "DishSumInt",
            "Сумма без скидки",
            "Сумма",
            "Выручка"
        );


    const orders =
        findOlapField(
            "UniqOrderId",
            "Заказ",
            "Количество заказов"
        );


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

                aggregation:
                    "SUM"
            });
        }


        if (orders) {

            olapMeasures.push({

                ...orders,

                aggregation:
                    "COUNT"
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

                aggregation:
                    "SUM"
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

                aggregation:
                    "SUM"
            });
        }


        if (orders) {

            olapMeasures.push({

                ...orders,

                aggregation:
                    "COUNT"
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

                aggregation:
                    "SUM"
            });
        }


        if (orders) {

            olapMeasures.push({

                ...orders,

                aggregation:
                    "COUNT"
            });
        }
    }


    renderSelectedOlapFields();
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


    const from =
        getElement(
            "olap-from"
        )?.value || "";


    const to =
        getElement(
            "olap-to"
        )?.value || "";


    if (
        !from ||
        !to
    ) {

        showOlapError(
            "Выберите дату начала и дату окончания"
        );

        return;
    }


    if (
        from > to
    ) {

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


    const runButton =
        getElement(
            "olap-run"
        );


    const result =
        getElement(
            "olap-result"
        );


    if (runButton) {

        runButton.disabled =
            true;

        runButton.textContent =
            "⏳ Строим отчёт...";
    }


    if (result) {

        result.innerHTML =
            `
            <div class="report-loading">
                ⏳ Отправляем запрос в iiko OLAP...
            </div>
            `;
    }


    try {

        /*
         * ВАЖНО:
         *
         * filters здесь НЕ отправляем
         * как массив:
         *
         * [
         *   { field: "..." }
         * ]
         *
         * backend ожидает объект filters.
         *
         * Пока фильтры UI не имеют значения,
         * поэтому отправляем пустой объект.
         */

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

            filters: {},

            measures:
                olapMeasures.map(
                    field => ({

                        field:
                            field.name,

                        aggregation:
                            field.aggregation ||
                            "SUM"
                    })
                )
        };


        console.log(
            "================================"
        );

        console.log(
            "OLAP REQUEST:"
        );

        console.log(
            payload
        );

        console.log(
            "================================"
        );


        const response =
            await fetch(
                "/api/iiko/olap",
                {
                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        "Accept":
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
            "OLAP RESPONSE:",
            data
        );


        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(

                data.message ||

                (
                    data.iikoHttpStatus
                        ? `iiko OLAP вернул HTTP ${data.iikoHttpStatus}`
                        : `Ошибка OLAP HTTP ${response.status}`
                )
            );
        }


        renderOlapResult(
            data,
            from,
            to
        );


    } catch (error) {

        console.error(
            "OLAP REPORT ERROR:",
            error
        );


        if (result) {

            result.innerHTML =
                `
                <div class="report-error">

                    🔴
                    ${escapeHtml(
                        error.message
                    )}

                </div>
                `;
        }


    } finally {

        if (runButton) {

            runButton.disabled =
                false;

            runButton.textContent =
                "▶️ Построить отчёт";
        }
    }
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


    const report =
        data.report ||
        data.data ||
        {};


    let rows = [];


    if (
        report &&
        Array.isArray(
            report.data
        )
    ) {

        rows =
            report.data;

    } else if (
        Array.isArray(
            data.data
        )
    ) {

        rows =
            data.data;

    } else if (
        Array.isArray(
            report
        )
    ) {

        rows =
            report;
    }


    if (
        !rows.length &&
        data.rawResponse
    ) {

        try {

            const raw =
                typeof data.rawResponse === "string"
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

                rows =
                    raw.data;
            }

        } catch (error) {

            console.warn(
                "Не удалось разобрать rawResponse",
                error
            );
        }
    }


    let html =
        `

        <div class="report-header">

            <h2>
                📊 OLAP отчёт
            </h2>

            <div class="report-period">

                ${formatDate(
                    from
                )}

                —

                ${formatDate(
                    to
                )}

            </div>

        </div>

        `;


    const cards =
        createOlapSummaryCards(
            rows
        );


    if (cards) {

        html +=
            cards;
    }


    html +=
        `
        <div class="report-table-wrapper">

            <h3>
                Данные
            </h3>

        `;


    html +=
        rows.length
            ? createOlapTable(
                rows
            )
            : `
                <div class="empty-report">

                    За выбранный период
                    данных нет.

                </div>
              `;


    html +=
        `
        </div>
        `;


    /*
     * Технический ответ оставляем.
     * Он очень полезен для диагностики
     * iiko OLAP.
     */

    html +=
        `

        <details
            style="
                margin-top:20px;
            "
        >

            <summary
                style="
                    cursor:pointer;
                    color:#64748b;
                    font-weight:700;
                "
            >
                Технический ответ iiko
            </summary>


            <pre
                style="
                    white-space:pre-wrap;
                    overflow:auto;
                    padding:15px;
                    margin-top:10px;
                    border-radius:8px;
                    background:#f5f5f5;
                    color:#222;
                    border:1px solid #ddd;
                    font-size:12px;
                    line-height:1.5;
                "
            >${escapeHtml(
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
// SUMMARY CARDS
// ============================================================

function createOlapSummaryCards(
    rows
) {

    if (
        !rows ||
        !rows.length
    ) {

        return "";
    }


    const numericFields =
        {};


    rows.forEach(
        row => {

            if (
                !row ||
                typeof row !== "object"
            ) {
                return;
            }


            Object.keys(
                row
            )
                .forEach(
                    key => {

                        const value =
                            row[key];


                        if (
                            typeof value ===
                            "number"
                        ) {

                            numericFields[key] =
                                (
                                    numericFields[key] ||
                                    0
                                ) +
                                value;
                        }
                    }
                );
        }
    );


    const keys =
        Object.keys(
            numericFields
        )
            .slice(
                0,
                3
            );


    if (!keys.length) {
        return "";
    }


    return `

        <div class="report-cards">

            ${keys
                .map(
                    key => `

                    <div class="report-card">

                        <div
                            class="report-card-title"
                        >
                            ${escapeHtml(
                                getFieldTitle(
                                    key
                                )
                            )}
                        </div>

                        <div
                            class="report-card-value"
                        >
                            ${formatNumber(
                                numericFields[key]
                            )}
                        </div>

                    </div>

                    `
                )
                .join("")
            }

        </div>

    `;
}


// ============================================================
// OLAP TABLE
// ============================================================

function createOlapTable(
    rows
) {

    const columns =
        [];


    rows.forEach(
        row => {

            if (
                !row ||
                typeof row !== "object"
            ) {
                return;
            }


            Object.keys(
                row
            )
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


    if (
        !columns.length
    ) {

        return `
            <div class="empty-report">
                Нет колонок для отображения.
            </div>
        `;
    }


    return `

        <table class="report-table">

            <thead>

                <tr>

                    ${columns
                        .map(
                            column =>
                                `
                                <th>
                                    ${escapeHtml(
                                        getFieldTitle(
                                            column
                                        )
                                    )}
                                </th>
                                `
                        )
                        .join("")
                    }

                </tr>

            </thead>


            <tbody>

                ${rows
                    .map(
                        row =>
                            `

                            <tr>

                                ${columns
                                    .map(
                                        column =>
                                            `
                                            <td>
                                                ${formatCellValue(
                                                    row[column]
                                                )}
                                            </td>
                                            `
                                    )
                                    .join("")
                                }

                            </tr>

                            `
                    )
                    .join("")
                }

            </tbody>

        </table>

    `;
}


// ============================================================
// FIELD TITLE
// ============================================================

function getFieldTitle(
    fieldName
) {

    const field =
        olapFields.find(
            item =>
                item.name ===
                fieldName
        );


    if (
        field &&
        field.title
    ) {

        return field.title;
    }


    return fieldName;
}


// ============================================================
// FORMAT CELL
// ============================================================

function formatCellValue(
    value
) {

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


    return escapeHtml(
        String(
            value
        )
    );
}


// ============================================================
// FORMAT NUMBER
// ============================================================

function formatNumber(
    value
) {

    const number =
        Number(
            value
        );


    if (
        Number.isNaN(
            number
        )
    ) {

        return escapeHtml(
            String(
                value
            )
        );
    }


    return new Intl.NumberFormat(
        "ru-RU",
        {
            minimumFractionDigits:
                0,

            maximumFractionDigits:
                2
        }
    )
        .format(
            number
        );
}


// ============================================================
// FORMAT DATE
// ============================================================

function formatDate(
    dateString
) {

    if (!dateString) {
        return "-";
    }


    const value =
        String(
            dateString
        )
            .slice(
                0,
                10
            );


    const parts =
        value.split(
            "-"
        );


    if (
        parts.length !== 3
    ) {

        return escapeHtml(
            dateString
        );
    }


    return (
        parts[2] +
        "." +
        parts[1] +
        "." +
        parts[0]
    );
}


// ============================================================
// OLAP ERROR
// ============================================================

function showOlapError(
    message
) {

    const result =
        getElement(
            "olap-result"
        );


    if (!result) {
        return;
    }


    result.innerHTML =
        `

        <div class="report-error">

            🔴
            ${escapeHtml(
                message
            )}

        </div>

        `;
}


// ============================================================
// SALES REPORT
//
// Этот endpoint НЕ МЕНЯЕМ:
// /api/iiko/sales
// ============================================================

if (loadSalesButton) {

    loadSalesButton.addEventListener(
        "click",
        async function () {

            if (!iikoConnection) {

                if (salesResult) {

                    salesResult.innerHTML =
                        `

                        <div class="report-error">

                            ⚠️ Сначала подключитесь
                            к iiko Server

                        </div>

                        `;
                }

                return;
            }


            const from =
                getElement(
                    "report-from"
                )?.value || "";


            const to =
                getElement(
                    "report-to"
                )?.value || "";


            if (
                !from ||
                !to
            ) {

                if (salesResult) {

                    salesResult.innerHTML =
                        `

                        <div class="report-error">

                            ⚠️ Выберите период

                        </div>

                        `;
                }

                return;
            }


            if (
                from > to
            ) {

                if (salesResult) {

                    salesResult.innerHTML =
                        `

                        <div class="report-error">

                            ⚠️ Дата начала
                            не может быть позже
                            даты окончания

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

                salesResult.innerHTML =
                    `

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
                                    "application/json",

                                "Accept":
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


                console.log(
                    "IIKO SALES RESPONSE:",
                    data
                );


                if (
                    !response.ok ||
                    data.success === false
                ) {

                    throw new Error(
                        data.message ||
                        `Ошибка получения отчёта HTTP ${response.status}`
                    );
                }


                const report =
                    data.report ||
                    {};


                const rows =
                    Array.isArray(
                        report.data
                    )
                        ? report.data
                        : [];


                let totalSales =
                    0;


                let totalOrders =
                    0;


                rows.forEach(
                    row => {

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
                    totalOrders > 0
                        ? totalSales /
                          totalOrders
                        : 0;


                const money =
                    new Intl.NumberFormat(
                        "ru-RU",
                        {
                            minimumFractionDigits:
                                2,

                            maximumFractionDigits:
                                2
                        }
                    );


                const number =
                    new Intl.NumberFormat(
                        "ru-RU"
                    );


                let html =
                    `

                    <div class="report-header">

                        <h2>
                            📊 Отчёт о продажах
                        </h2>

                        <div class="report-period">

                            ${formatDate(
                                from
                            )}

                            —

                            ${formatDate(
                                to
                            )}

                        </div>

                    </div>


                    <div class="report-cards">


                        <div class="report-card">

                            <div
                                class="report-card-title"
                            >
                                💰 Выручка
                            </div>

                            <div
                                class="report-card-value"
                            >
                                ${money.format(
                                    totalSales
                                )}
                            </div>

                        </div>


                        <div class="report-card">

                            <div
                                class="report-card-title"
                            >
                                🧾 Заказы
                            </div>

                            <div
                                class="report-card-value"
                            >
                                ${number.format(
                                    totalOrders
                                )}
                            </div>

                        </div>


                        <div class="report-card">

                            <div
                                class="report-card-title"
                            >
                                💵 Средний чек
                            </div>

                            <div
                                class="report-card-value"
                            >
                                ${money.format(
                                    averageCheck
                                )}
                            </div>

                        </div>


                    </div>


                    <div class="report-table-wrapper">

                        <h3>
                            Продажи по дням
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


                if (
                    rows.length === 0
                ) {

                    html +=
                        `

                        <tr>

                            <td
                                colspan="4"
                                class="empty-report"
                            >

                                Продаж за выбранный
                                период нет

                            </td>

                        </tr>

                        `;

                } else {

                    rows.forEach(
                        row => {

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
                                orders > 0
                                    ? sales /
                                      orders
                                    : 0;


                            const date =
                                row[
                                    "OpenDate.Typed"
                                ];


                            html +=
                                `

                                <tr>

                                    <td>
                                        ${formatDate(
                                            date
                                        )}
                                    </td>

                                    <td>
                                        ${money.format(
                                            sales
                                        )}
                                    </td>

                                    <td>
                                        ${number.format(
                                            orders
                                        )}
                                    </td>

                                    <td>
                                        ${money.format(
                                            average
                                        )}
                                    </td>

                                </tr>

                                `;
                        }
                    );
                }


                html +=
                    `

                            </tbody>

                        </table>

                    </div>

                    `;


                if (salesResult) {

                    salesResult.innerHTML =
                        html;
                }


            } catch (error) {

                console.error(
                    "Ошибка отчёта:",
                    error
                );


                if (salesResult) {

                    salesResult.innerHTML =
                        `

                        <div class="report-error">

                            🔴
                            ${escapeHtml(
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
// START
// ============================================================

loadSavedIikoData();


// ============================================================
// OPTIONAL:
// если данные уже сохранены,
// НЕ подключаем автоматически.
// Пользователь сам нажимает
// "Подключиться".
// ============================================================
