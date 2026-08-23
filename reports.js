// ============================================================
// ANAR SYSTEM
// IIKO REPORTS + OLAP CONSTRUCTOR
// DRAG & DROP VERSION
// ============================================================


// ============================================================
// ELEMENTS
// ============================================================

const connectButton =
    document.getElementById("connect-iiko");

const statusElement =
    document.getElementById("iiko-status");

const salesCard =
    document.getElementById("sales-card");

const loadSalesButton =
    document.getElementById("load-sales");

const salesResult =
    document.getElementById("sales-result");

const rememberIiko =
    document.getElementById("remember-iiko");

const clearIikoData =
    document.getElementById("clear-iiko-data");


// ============================================================
// IIKO STATE
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

let draggedField = null;


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

        document.getElementById(
            "iiko-ip"
        ).value = data.ip || "";

        document.getElementById(
            "iiko-port"
        ).value = data.port || "";

        document.getElementById(
            "iiko-login"
        ).value = data.login || "";

        document.getElementById(
            "iiko-password"
        ).value = data.password || "";

        rememberIiko.checked = true;

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

    const data = {

        ip:
            document.getElementById(
                "iiko-ip"
            ).value.trim(),

        port:
            document.getElementById(
                "iiko-port"
            ).value.trim(),

        login:
            document.getElementById(
                "iiko-login"
            ).value.trim(),

        password:
            document.getElementById(
                "iiko-password"
            ).value
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

            document.getElementById(
                "iiko-ip"
            ).value = "";

            document.getElementById(
                "iiko-port"
            ).value = "";

            document.getElementById(
                "iiko-login"
            ).value = "";

            document.getElementById(
                "iiko-password"
            ).value = "";

            rememberIiko.checked = false;

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
                document.getElementById(
                    "olap-builder"
                );

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

            const ip =
                document.getElementById(
                    "iiko-ip"
                ).value.trim();

            const port =
                document.getElementById(
                    "iiko-port"
                ).value.trim();

            const login =
                document.getElementById(
                    "iiko-login"
                ).value.trim();

            const password =
                document.getElementById(
                    "iiko-password"
                ).value;

            if (
                !ip ||
                !port ||
                !login ||
                !password
            ) {

                statusElement.textContent =
                    "⚠️ Заполните все поля";

                return;
            }

            connectButton.disabled = true;

            connectButton.textContent =
                "Подключение...";

            statusElement.textContent =
                "⏳ Подключаемся к iiko Server...";

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
                    await safeJson(response);

                console.log(
                    "Ответ connect:",
                    data
                );

                if (
                    !response.ok ||
                    !data.success
                ) {

                    throw new Error(
                        data.message ||
                        "Ошибка подключения"
                    );
                }

                if (
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

                statusElement.textContent =
                    "🟢 iiko Server подключён";

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

                statusElement.textContent =
                    "🔴 " +
                    error.message;

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

    const oldBuilder =
        document.getElementById(
            "olap-builder"
        );

    if (oldBuilder) {
        oldBuilder.remove();
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

    builder.className =
        "olap-builder";

    builder.innerHTML = `

        <div class="olap-modern-header">

            <div>

                <div class="olap-title">
                    🧩 Конструктор OLAP
                </div>

                <div class="olap-subtitle">
                    Перетаскивайте поля мышкой
                    и собирайте свой отчёт
                </div>

            </div>

            <div class="olap-header-actions">

                <button
                    type="button"
                    id="olap-template-sales"
                >
                    💰 Продажи
                </button>

                <button
                    type="button"
                    id="olap-template-day"
                >
                    📅 По дням
                </button>

                <button
                    type="button"
                    id="olap-clear"
                >
                    Очистить
                </button>

            </div>

        </div>


        <div
            id="olap-status"
            class="olap-status"
        >
            ⏳ Загрузка полей...
        </div>


        <div class="olap-builder-grid">


            <!-- =================================================
                 AVAILABLE FIELDS
                 ================================================= -->

            <div class="olap-source">

                <div class="olap-section-title">

                    <span>
                        📚 Доступные поля
                    </span>

                    <span
                        id="olap-fields-count"
                        class="olap-count"
                    >
                        0
                    </span>

                </div>


                <div class="olap-search-wrapper">

                    <span>🔍</span>

                    <input
                        id="olap-search"
                        type="text"
                        placeholder="Поиск поля..."
                    >

                </div>


                <div
                    id="olap-fields"
                    class="olap-fields"
                >

                    <div class="olap-empty">
                        Загрузка...
                    </div>

                </div>

            </div>


            <!-- =================================================
                 CONSTRUCTOR
                 ================================================= -->

            <div class="olap-workspace">


                <!-- ROWS -->

                <div class="drop-section">

                    <div class="drop-title">

                        <span>
                            ↕️ Строки
                        </span>

                        <span>
                            Перетащите поля сюда
                        </span>

                    </div>

                    <div
                        id="olap-rows"
                        class="drop-zone"
                        data-zone="rows"
                    >

                        <div class="drop-empty">
                            Перетащите поле сюда
                        </div>

                    </div>

                </div>


                <!-- COLUMNS -->

                <div class="drop-section">

                    <div class="drop-title">

                        <span>
                            ↔️ Колонки
                        </span>

                        <span>
                            Необязательно
                        </span>

                    </div>

                    <div
                        id="olap-columns"
                        class="drop-zone"
                        data-zone="columns"
                    >

                        <div class="drop-empty">
                            Перетащите поле сюда
                        </div>

                    </div>

                </div>


                <!-- MEASURES -->

                <div class="drop-section">

                    <div class="drop-title">

                        <span>
                            📊 Показатели
                        </span>

                        <span>
                            SUM / AVG / COUNT
                        </span>

                    </div>

                    <div
                        id="olap-measures"
                        class="drop-zone"
                        data-zone="measures"
                    >

                        <div class="drop-empty">
                            Перетащите числовое поле сюда
                        </div>

                    </div>

                </div>


                <!-- FILTERS -->

                <div class="drop-section">

                    <div class="drop-title">

                        <span>
                            🔎 Фильтры
                        </span>

                        <span>
                            Необязательно
                        </span>

                    </div>

                    <div
                        id="olap-filters"
                        class="drop-zone"
                        data-zone="filters"
                    >

                        <div class="drop-empty">
                            Перетащите поле сюда
                        </div>

                    </div>

                </div>


                <!-- PERIOD -->

                <div class="olap-period">

                    <div class="drop-title">

                        <span>
                            📅 Период отчёта
                        </span>

                    </div>

                    <div class="period-grid">

                        <label>

                            От

                            <input
                                type="date"
                                id="olap-from"
                            >

                        </label>

                        <label>

                            До

                            <input
                                type="date"
                                id="olap-to"
                            >

                        </label>

                    </div>

                </div>


                <!-- ACTION -->

                <button
                    type="button"
                    id="olap-run"
                    class="olap-run-button"
                >
                    ▶️ Построить отчёт
                </button>


            </div>

        </div>


        <!-- RESULT -->

        <div
            id="olap-result"
            class="olap-result"
        ></div>

    `;


    container.appendChild(
        builder
    );


    injectOlapStyles();


    document
        .getElementById(
            "olap-search"
        )
        .addEventListener(
            "input",
            renderOlapFields
        );


    document
        .getElementById(
            "olap-run"
        )
        .addEventListener(
            "click",
            runOlapReport
        );


    document
        .getElementById(
            "olap-clear"
        )
        .addEventListener(
            "click",
            clearOlapBuilder
        );


    document
        .getElementById(
            "olap-template-sales"
        )
        .addEventListener(
            "click",
            applySalesTemplate
        );


    document
        .getElementById(
            "olap-template-day"
        )
        .addEventListener(
            "click",
            applyDayTemplate
        );


    setupDropZones();

    setDefaultOlapDates();
}


// ============================================================
// MODERN CSS
// ============================================================

function injectOlapStyles() {

    if (
        document.getElementById(
            "olap-modern-styles"
        )
    ) {
        return;
    }

    const style =
        document.createElement(
            "style"
        );

    style.id =
        "olap-modern-styles";

    style.textContent = `

        #olap-builder {
            margin-top: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 20px;
            overflow: hidden;
            background: #fff;
            box-shadow:
                0 12px 35px
                rgba(15,23,42,.08);
        }


        .olap-modern-header {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:20px;
            padding:24px 28px;
            border-bottom:1px solid #edf0f3;
            background:
                linear-gradient(
                    135deg,
                    #ffffff,
                    #f8fafc
                );
        }


        .olap-title {
            font-size:24px;
            font-weight:800;
            color:#0f172a;
        }


        .olap-subtitle {
            margin-top:5px;
            color:#64748b;
            font-size:13px;
        }


        .olap-header-actions {
            display:flex;
            gap:8px;
            flex-wrap:wrap;
        }


        .olap-header-actions button {
            border:1px solid #dbe1e8;
            background:#fff;
            color:#334155;
            border-radius:10px;
            padding:9px 13px;
            cursor:pointer;
            font-weight:600;
        }


        .olap-header-actions button:hover {
            background:#f8fafc;
        }


        .olap-status {
            padding:12px 28px;
            background:#f8fafc;
            color:#64748b;
            font-size:13px;
            border-bottom:1px solid #edf0f3;
        }


        .olap-builder-grid {
            display:grid;
            grid-template-columns:
                minmax(280px, .75fr)
                minmax(450px, 1.25fr);
            min-height:650px;
        }


        .olap-source {
            padding:22px;
            border-right:1px solid #edf0f3;
            background:#fbfcfd;
        }


        .olap-workspace {
            padding:22px;
        }


        .olap-section-title {
            display:flex;
            align-items:center;
            justify-content:space-between;
            margin-bottom:12px;
            font-size:14px;
            font-weight:800;
            color:#1e293b;
        }


        .olap-count {
            padding:3px 8px;
            border-radius:20px;
            background:#e2e8f0;
            color:#475569;
            font-size:11px;
        }


        .olap-search-wrapper {
            display:flex;
            align-items:center;
            gap:8px;
            height:44px;
            padding:0 12px;
            border:1px solid #e2e8f0;
            border-radius:11px;
            background:#fff;
            margin-bottom:12px;
        }


        .olap-search-wrapper input {
            width:100%;
            border:0;
            outline:0;
            background:transparent;
            font-size:14px;
        }


        .olap-fields {
            display:flex;
            flex-direction:column;
            gap:7px;
            max-height:570px;
            overflow:auto;
            padding-right:4px;
        }


        .olap-field-card {
            display:flex;
            align-items:center;
            gap:10px;
            width:100%;
            min-height:58px;
            padding:9px 11px;
            border:1px solid #e5e7eb;
            border-radius:11px;
            background:#fff;
            cursor:grab;
            user-select:none;
            transition:.15s;
        }


        .olap-field-card:hover {
            transform:translateY(-1px);
            border-color:#cbd5e1;
            box-shadow:
                0 5px 15px
                rgba(15,23,42,.06);
        }


        .olap-field-card.dragging {
            opacity:.45;
            transform:scale(.98);
        }


        .field-icon {
            display:flex;
            align-items:center;
            justify-content:center;
            flex:0 0 34px;
            width:34px;
            height:34px;
            border-radius:9px;
            background:#f1f5f9;
        }


        .field-text {
            min-width:0;
            flex:1;
        }


        .field-title {
            display:block;
            overflow:hidden;
            color:#1e293b;
            font-size:13px;
            font-weight:700;
            white-space:nowrap;
            text-overflow:ellipsis;
        }


        .field-name {
            display:block;
            margin-top:3px;
            overflow:hidden;
            color:#94a3b8;
            font-size:11px;
            white-space:nowrap;
            text-overflow:ellipsis;
        }


        .field-add {
            border:0;
            background:#f8fafc;
            border-radius:8px;
            width:30px;
            height:30px;
            cursor:pointer;
        }


        .drop-section {
            margin-bottom:16px;
        }


        .drop-title {
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:8px;
            color:#334155;
            font-size:12px;
            font-weight:800;
            text-transform:uppercase;
            letter-spacing:.03em;
        }


        .drop-title span:last-child {
            color:#94a3b8;
            font-size:10px;
            font-weight:600;
            text-transform:none;
        }


        .drop-zone {
            min-height:82px;
            padding:8px;
            border:1.5px dashed #cbd5e1;
            border-radius:13px;
            background:#f8fafc;
            transition:.15s;
        }


        .drop-zone.drag-over {
            border-color:#64748b;
            background:#f1f5f9;
            box-shadow:
                inset 0 0 0 2px
                rgba(100,116,139,.08);
        }


        .drop-empty {
            display:flex;
            align-items:center;
            justify-content:center;
            min-height:62px;
            color:#94a3b8;
            font-size:12px;
            text-align:center;
        }


        .selected-field {
            display:flex;
            align-items:center;
            gap:10px;
            min-height:52px;
            padding:8px 10px;
            margin-bottom:7px;
            border:1px solid #e2e8f0;
            border-radius:10px;
            background:#fff;
            cursor:grab;
            box-shadow:
                0 2px 7px
                rgba(15,23,42,.04);
        }


        .selected-field:last-child {
            margin-bottom:0;
        }


        .selected-field.dragging {
            opacity:.4;
        }


        .selected-main {
            flex:1;
            min-width:0;
        }


        .selected-main strong {
            display:block;
            overflow:hidden;
            color:#1e293b;
            font-size:13px;
            white-space:nowrap;
            text-overflow:ellipsis;
        }


        .selected-main small {
            display:block;
            margin-top:3px;
            color:#94a3b8;
            font-size:11px;
        }


        .selected-remove {
            border:0;
            background:transparent;
            color:#94a3b8;
            font-size:19px;
            cursor:pointer;
            width:30px;
            height:30px;
            border-radius:8px;
        }


        .selected-remove:hover {
            background:#fef2f2;
            color:#dc2626;
        }


        .measure-select {
            height:32px;
            border:1px solid #e2e8f0;
            border-radius:8px;
            background:#fff;
            font-size:11px;
        }


        .olap-period {
            margin-top:20px;
            padding:16px;
            border:1px solid #e5e7eb;
            border-radius:13px;
            background:#fafbfc;
        }


        .period-grid {
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:10px;
        }


        .period-grid label {
            color:#64748b;
            font-size:11px;
            font-weight:700;
        }


        .period-grid input {
            display:block;
            width:100%;
            box-sizing:border-box;
            height:40px;
            margin-top:6px;
            padding:0 10px;
            border:1px solid #dfe3e8;
            border-radius:9px;
            background:#fff;
        }


        .olap-run-button {
            width:100%;
            height:50px;
            margin-top:16px;
            border:0;
            border-radius:12px;
            background:
                linear-gradient(
                    135deg,
                    #111827,
                    #334155
                );
            color:#fff;
            font-size:14px;
            font-weight:800;
            cursor:pointer;
            box-shadow:
                0 8px 18px
                rgba(15,23,42,.18);
        }


        .olap-run-button:hover {
            transform:translateY(-1px);
        }


        .olap-run-button:disabled {
            opacity:.6;
            cursor:wait;
        }


        .olap-result {
            padding:26px 28px;
            border-top:1px solid #edf0f3;
            background:#fbfcfd;
        }


        @media(max-width:900px) {

            .olap-builder-grid {
                grid-template-columns:1fr;
            }

            .olap-source {
                border-right:0;
                border-bottom:1px solid #edf0f3;
            }

        }


        @media(max-width:600px) {

            .olap-modern-header {
                flex-direction:column;
                align-items:flex-start;
                padding:20px;
            }

            .olap-source,
            .olap-workspace {
                padding:16px;
            }

            .period-grid {
                grid-template-columns:1fr;
            }

        }

    `;

    document.head.appendChild(
        style
    );
}


// ============================================================
// DEFAULT DATES
// ============================================================

function setDefaultOlapDates() {

    const from =
        document.getElementById(
            "olap-from"
        );

    const to =
        document.getElementById(
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
        ).padStart(2, "0");

    const dd =
        String(
            now.getDate()
        ).padStart(2, "0");

    const today =
        `${yyyy}-${mm}-${dd}`;

    if (!from.value) {
        from.value = today;
    }

    if (!to.value) {
        to.value = today;
    }

    const salesFrom =
        document.getElementById(
            "report-from"
        );

    const salesTo =
        document.getElementById(
            "report-to"
        );

    if (
        salesFrom &&
        !salesFrom.value
    ) {
        salesFrom.value = today;
    }

    if (
        salesTo &&
        !salesTo.value
    ) {
        salesTo.value = today;
    }
}


// ============================================================
// LOAD REAL OLAP FIELDS
// ============================================================

async function loadOlapFields() {

    if (!iikoConnection) {
        return;
    }

    const status =
        document.getElementById(
            "olap-status"
        );

    if (status) {

        status.textContent =
            "⏳ Получаем реальные поля OLAP из iiko...";
    }

    try {

        const response =
            await fetch(
                "/api/iiko/olap/fields",
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
                                iikoConnection.password

                        })
                }
            );

        const data =
            await safeJson(response);

        console.log(
            "OLAP FIELDS RESPONSE:",
            data
        );

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Не удалось получить поля OLAP"
            );
        }

        olapFields =
            extractOlapFields(
                data
            );

        renderOlapFields();

        if (status) {

            status.textContent =
                `🟢 Загружено полей: ${olapFields.length}`;
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

        const fieldsContainer =
            document.getElementById(
                "olap-fields"
            );

        if (fieldsContainer) {

            fieldsContainer.innerHTML = `

                <div class="report-error">

                    ${escapeHtml(
                        error.message
                    )}

                </div>

            `;
        }
    }
}


// ============================================================
// EXTRACT FIELDS
// ============================================================

function extractOlapFields(data) {

    let fields = [];

    if (
        Array.isArray(
            data.fields
        )
    ) {

        fields =
            data.fields;

    } else if (
        Array.isArray(
            data.data
        )
    ) {

        fields =
            data.data;

    } else if (
        data.fields &&
        typeof data.fields ===
            "object"
    ) {

        if (
            Array.isArray(
                data.fields.fields
            )
        ) {

            fields =
                data.fields.fields;

        } else {

            const dimensions =
                Array.isArray(
                    data.fields.dimensions
                )
                    ? data.fields.dimensions
                    : [];

            const measures =
                Array.isArray(
                    data.fields.measures
                )
                    ? data.fields.measures
                    : [];

            fields = [
                ...dimensions,
                ...measures
            ];
        }
    }

    return fields
        .map(
            (field, index) => {

                if (
                    typeof field ===
                    "string"
                ) {

                    return {

                        name: field,

                        title: field,

                        type: "unknown",

                        isMeasure: false,

                        index
                    };
                }

                const name =
                    field.name ||
                    field.field ||
                    field.key ||
                    field.code ||
                    field.id ||
                    "";

                const title =
                    field.title ||
                    field.caption ||
                    field.label ||
                    name;

                const type =
                    String(
                        field.type ||
                        field.dataType ||
                        field.kind ||
                        ""
                    );

                const lowerType =
                    type.toLowerCase();

                const isMeasure =
                    Boolean(

                        field.isMeasure ||

                        field.measure ||

                        field.is_metric ||

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
                        )
                    );

                return {

                    ...field,

                    name,

                    title,

                    type,

                    isMeasure,

                    index
                };
            }
        )
        .filter(
            field =>
                field.name
        );
}


// ============================================================
// RENDER AVAILABLE FIELDS
// ============================================================

function renderOlapFields() {

    const container =
        document.getElementById(
            "olap-fields"
        );

    if (!container) {
        return;
    }

    const searchInput =
        document.getElementById(
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
                    (
                        field.name +
                        " " +
                        field.title +
                        " " +
                        field.type
                    ).toLowerCase();

                return text.includes(
                    search
                );
            }
        );

    const count =
        document.getElementById(
            "olap-fields-count"
        );

    if (count) {
        count.textContent =
            filtered.length;
    }

    if (
        filtered.length === 0
    ) {

        container.innerHTML = `

            <div class="olap-empty">

                ${
                    olapFields.length === 0
                        ? "Поля не найдены"
                        : "По вашему запросу ничего не найдено"
                }

            </div>

        `;

        return;
    }

    container.innerHTML = "";

    filtered.forEach(
        field => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "olap-field-card";

            card.draggable =
                true;

            card.dataset.field =
                field.name;

            card.innerHTML = `

                <div class="field-icon">

                    ${
                        field.isMeasure
                            ? "📊"
                            : "▤"
                    }

                </div>


                <div class="field-text">

                    <span class="field-title">

                        ${escapeHtml(
                            field.title ||
                            field.name
                        )}

                    </span>

                    <span class="field-name">

                        ${escapeHtml(
                            field.name
                        )}

                    </span>

                </div>


                <button
                    type="button"
                    class="field-add"
                    title="Добавить"
                >
                    ＋
                </button>

            `;


            card.addEventListener(
                "dragstart",
                function (event) {

                    draggedField =
                        field;

                    card.classList.add(
                        "dragging"
                    );

                    event.dataTransfer.effectAllowed =
                        "copy";

                    event.dataTransfer.setData(
                        "text/plain",
                        field.name
                    );
                }
            );


            card.addEventListener(
                "dragend",
                function () {

                    draggedField =
                        null;

                    card.classList.remove(
                        "dragging"
                    );

                    document
                        .querySelectorAll(
                            ".drop-zone"
                        )
                        .forEach(
                            zone =>
                                zone.classList.remove(
                                    "drag-over"
                                )
                        );
                }
            );


            card.querySelector(
                ".field-add"
            ).addEventListener(
                "click",
                function (event) {

                    event.stopPropagation();

                    addFieldByClick(
                        field
                    );
                }
            );


            card.addEventListener(
                "dblclick",
                function () {

                    addFieldByClick(
                        field
                    );
                }
            );


            container.appendChild(
                card
            );
        }
    );
}


// ============================================================
// CLICK ADD
// ============================================================

function addFieldByClick(field) {

    if (!field) {
        return;
    }

    if (
        field.isMeasure
    ) {

        addFieldToZone(
            field,
            "measures"
        );

    } else {

        addFieldToZone(
            field,
            "rows"
        );
    }
}


// ============================================================
// DROP ZONES
// ============================================================

function setupDropZones() {

    document
        .querySelectorAll(
            ".drop-zone"
        )
        .forEach(
            zone => {

                zone.addEventListener(
                    "dragover",
                    function (event) {

                        event.preventDefault();

                        zone.classList.add(
                            "drag-over"
                        );
                    }
                );


                zone.addEventListener(
                    "dragleave",
                    function () {

                        zone.classList.remove(
                            "drag-over"
                        );
                    }
                );


                zone.addEventListener(
                    "drop",
                    function (event) {

                        event.preventDefault();

                        zone.classList.remove(
                            "drag-over"
                        );

                        let field =
                            draggedField;

                        if (!field) {

                            const name =
                                event.dataTransfer.getData(
                                    "text/plain"
                                );

                            field =
                                olapFields.find(
                                    item =>
                                        item.name ===
                                        name
                                );
                        }

                        if (!field) {
                            return;
                        }

                        const targetZone =
                            zone.dataset.zone;

                        addFieldToZone(
                            field,
                            targetZone
                        );
                    }
                );
            }
        );
}


// ============================================================
// ADD FIELD TO ZONE
// ============================================================

function addFieldToZone(
    field,
    zone
) {

    if (
        !field ||
        !field.name
    ) {
        return;
    }


    removeFieldEverywhere(
        field.name
    );


    if (
        zone === "measures"
    ) {

        olapMeasures.push({

            ...field,

            aggregation:
                getDefaultAggregation(
                    field
                )
        });

    } else if (
        zone === "columns"
    ) {

        olapColumns.push(
            field
        );

    } else if (
        zone === "filters"
    ) {

        olapFilters.push(
            field
        );

    } else {

        olapRows.push(
            field
        );
    }


    renderSelectedOlapFields();
}


// ============================================================
// REMOVE FIELD EVERYWHERE
// ============================================================

function removeFieldEverywhere(
    name
) {

    olapRows =
        olapRows.filter(
            item =>
                item.name !== name
        );

    olapColumns =
        olapColumns.filter(
            item =>
                item.name !== name
        );

    olapMeasures =
        olapMeasures.filter(
            item =>
                item.name !== name
        );

    olapFilters =
        olapFilters.filter(
            item =>
                item.name !== name
        );
}


// ============================================================
// DEFAULT AGGREGATION
// ============================================================

function getDefaultAggregation(
    field
) {

    const type =
        String(
            field.type ||
            ""
        ).toLowerCase();

    if (
        type.includes("count")
    ) {
        return "COUNT";
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
        document.getElementById(
            elementId
        );

    if (!container) {
        return;
    }


    if (
        fields.length === 0
    ) {

        const text =
            group === "rows"
                ? "Перетащите поля сюда"
                : group === "columns"
                    ? "Перетащите поле сюда"
                    : group === "measures"
                        ? "Перетащите числовое поле сюда"
                        : "Перетащите поле-фильтр сюда";

        container.innerHTML = `

            <div class="drop-empty">

                ${text}

            </div>

        `;

        return;
    }


    container.innerHTML = "";


    fields.forEach(
        (field, index) => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "selected-field";

            item.draggable =
                true;

            item.dataset.field =
                field.name;


            let controls = "";


            if (
                group === "measures"
            ) {

                controls = `

                    <select
                        class="measure-select"
                    >

                        <option
                            value="SUM"
                            ${
                                field.aggregation === "SUM"
                                    ? "selected"
                                    : ""
                            }
                        >
                            SUM
                        </option>

                        <option
                            value="COUNT"
                            ${
                                field.aggregation === "COUNT"
                                    ? "selected"
                                    : ""
                            }
                        >
                            COUNT
                        </option>

                        <option
                            value="AVG"
                            ${
                                field.aggregation === "AVG"
                                    ? "selected"
                                    : ""
                            }
                        >
                            AVG
                        </option>

                        <option
                            value="MIN"
                            ${
                                field.aggregation === "MIN"
                                    ? "selected"
                                    : ""
                            }
                        >
                            MIN
                        </option>

                        <option
                            value="MAX"
                            ${
                                field.aggregation === "MAX"
                                    ? "selected"
                                    : ""
                            }
                        >
                            MAX
                        </option>

                    </select>

                `;
            }


            item.innerHTML = `

                <div class="field-icon">

                    ${
                        group === "measures"
                            ? "📊"
                            : group === "filters"
                                ? "🔎"
                                : group === "columns"
                                    ? "↔️"
                                    : "↕️"
                    }

                </div>


                <div class="selected-main">

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

                </div>


                ${controls}


                <button
                    type="button"
                    class="selected-remove"
                    title="Удалить"
                >
                    ×
                </button>

            `;


            item.addEventListener(
                "dragstart",
                function (event) {

                    draggedField =
                        field;

                    item.classList.add(
                        "dragging"
                    );

                    event.dataTransfer.effectAllowed =
                        "move";

                    event.dataTransfer.setData(
                        "text/plain",
                        field.name
                    );
                }
            );


            item.addEventListener(
                "dragend",
                function () {

                    draggedField =
                        null;

                    item.classList.remove(
                        "dragging"
                    );
                }
            );


            item.querySelector(
                ".selected-remove"
            ).addEventListener(
                "click",
                function () {

                    fields.splice(
                        index,
                        1
                    );

                    renderSelectedOlapFields();
                }
            );


            const select =
                item.querySelector(
                    ".measure-select"
                );

            if (select) {

                select.addEventListener(
                    "change",
                    function () {

                        field.aggregation =
                            select.value;
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
// CLEAR BUILDER
// ============================================================

function clearOlapBuilder() {

    olapRows = [];
    olapColumns = [];
    olapMeasures = [];
    olapFilters = [];

    const result =
        document.getElementById(
            "olap-result"
        );

    if (result) {
        result.innerHTML = "";
    }

    renderSelectedOlapFields();
}


// ============================================================
// TEMPLATES
// ============================================================

function findField(
    words
) {

    const list =
        Array.isArray(words)
            ? words
            : [words];

    return olapFields.find(
        field => {

            const text =
                (
                    field.name +
                    " " +
                    field.title
                ).toLowerCase();

            return list.some(
                word =>
                    text.includes(
                        word.toLowerCase()
                    )
            );
        }
    );
}


// ============================================================
// SALES TEMPLATE
// ============================================================

function applySalesTemplate() {

    clearOlapBuilder();

    const date =
        findField([
            "date",
            "дата",
            "open"
        ]);

    const dish =
        findField([
            "dish",
            "блюд",
            "product",
            "товар"
        ]);

    const sales =
        findField([
            "sum",
            "сумм",
            "sales",
            "выруч"
        ]);

    if (date) {

        addFieldToZone(
            date,
            "rows"
        );
    }

    if (dish) {

        addFieldToZone(
            dish,
            "rows"
        );
    }

    if (sales) {

        addFieldToZone(
            sales,
            "measures"
        );
    }
}


// ============================================================
// DAY TEMPLATE
// ============================================================

function applyDayTemplate() {

    clearOlapBuilder();

    const date =
        findField([
            "date",
            "дата",
            "open"
        ]);

    const sales =
        findField([
            "sum",
            "сумм",
            "sales",
            "выруч"
        ]);

    if (date) {

        addFieldToZone(
            date,
            "rows"
        );
    }

    if (sales) {

        addFieldToZone(
            sales,
            "measures"
        );
    }
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
        document.getElementById(
            "olap-from"
        ).value;

    const to =
        document.getElementById(
            "olap-to"
        ).value;


    if (!from || !to) {

        showOlapError(
            "Выберите дату начала и дату окончания"
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
        olapRows.length === 0 &&
        olapColumns.length === 0 &&
        olapMeasures.length === 0
    ) {

        showOlapError(
            "Добавьте хотя бы одно поле"
        );

        return;
    }


    const runButton =
        document.getElementById(
            "olap-run"
        );

    const result =
        document.getElementById(
            "olap-result"
        );


    runButton.disabled = true;

    runButton.textContent =
        "⏳ Строим отчёт...";


    result.innerHTML = `

        <div class="report-loading">

            ⏳ Отправляем запрос
            в iiko OLAP...

        </div>

    `;


    try {

        const payload = {

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

            filters:
                olapFilters.map(
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
                            "SUM"

                    })
                )
        };


        console.log(
            "OLAP REQUEST:",
            payload
        );


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
            "OLAP RESPONSE:",
            data
        );


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Ошибка построения OLAP отчёта"
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


        result.innerHTML = `

            <div class="report-error">

                🔴

                ${escapeHtml(
                    error.message
                )}

            </div>

        `;

    } finally {

        runButton.disabled =
            false;

        runButton.textContent =
            "▶️ Построить отчёт";
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
        document.getElementById(
            "olap-result"
        );


    const report =
        data.report ||
        data.data ||
        {};


    let rows = [];


    if (
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
        rows.length === 0 &&
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


    let html = `

        <div class="report-header">

            <h2>
                📊 OLAP отчёт
            </h2>

            <div class="report-period">

                ${formatDate(from)}

                —

                ${formatDate(to)}

            </div>

        </div>

    `;


    const cards =
        createOlapSummaryCards(
            rows
        );


    if (cards) {
        html += cards;
    }


    html += `

        <div class="report-table-wrapper">

            <h3>
                Данные
            </h3>

    `;


    if (
        rows.length === 0
    ) {

        html += `

            <div class="empty-report">

                За выбранный период
                данных нет.

            </div>

        `;

    } else {

        html +=
            createOlapTable(
                rows
            );
    }


    html += `

        </div>

    `;


    html += `

        <details style="
            margin-top:20px;
        ">

            <summary style="
                cursor:pointer;
                color:#64748b;
                font-weight:600;
            ">

                Технический ответ iiko

            </summary>

            <pre style="
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
// SUMMARY CARDS
// ============================================================

function createOlapSummaryCards(
    rows
) {

    if (
        !rows ||
        rows.length === 0
    ) {
        return "";
    }


    const numericFields = {};


    rows.forEach(
        row => {

            Object.keys(
                row
            ).forEach(
                key => {

                    const value =
                        row[key];


                    if (
                        typeof value ===
                        "number"
                    ) {

                        if (
                            !numericFields[
                                key
                            ]
                        ) {

                            numericFields[
                                key
                            ] = 0;
                        }


                        numericFields[
                            key
                        ] += value;
                    }
                }
            );
        }
    );


    const keys =
        Object.keys(
            numericFields
        );


    if (
        keys.length === 0
    ) {
        return "";
    }


    const selected =
        keys.slice(
            0,
            3
        );


    let html = `

        <div class="report-cards">

    `;


    selected.forEach(
        key => {

            html += `

                <div class="report-card">

                    <div class="report-card-title">

                        ${escapeHtml(
                            getFieldTitle(
                                key
                            )
                        )}

                    </div>

                    <div class="report-card-value">

                        ${formatNumber(
                            numericFields[
                                key
                            ]
                        )}

                    </div>

                </div>

            `;
        }
    );


    html += `

        </div>

    `;


    return html;
}


// ============================================================
// TABLE
// ============================================================

function createOlapTable(
    rows
) {

    const columns = [];


    rows.forEach(
        row => {

            Object.keys(
                row
            ).forEach(
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
        columns.length === 0
    ) {

        return `

            <div class="empty-report">

                Нет колонок
                для отображения.

            </div>

        `;
    }


    let html = `

        <table class="report-table">

            <thead>

                <tr>

    `;


    columns.forEach(
        column => {

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
        row => {

            html += `

                <tr>

            `;


            columns.forEach(
                column => {

                    const value =
                        row[column];


                    html += `

                        <td>

                            ${formatCellValue(
                                value
                            )}

                        </td>

                    `;
                }
            );


            html += `

                </tr>

            `;
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
        typeof value ===
        "number"
    ) {

        return formatNumber(
            value
        );
    }


    return escapeHtml(
        String(value)
    );
}


// ============================================================
// FORMAT NUMBER
// ============================================================

function formatNumber(
    value
) {

    const number =
        Number(value);


    if (
        Number.isNaN(number)
    ) {

        return escapeHtml(
            String(value)
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
    ).format(
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


    const parts =
        String(
            dateString
        ).split("-");


    if (
        parts.length !== 3
    ) {

        return dateString;
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
        document.getElementById(
            "olap-result"
        );


    if (!result) {
        return;
    }


    result.innerHTML = `

        <div class="report-error">

            🔴

            ${escapeHtml(
                message
            )}

        </div>

    `;
}


// ============================================================
// SAFE JSON
// ============================================================

async function safeJson(
    response
) {

    const text =
        await response.text();


    if (!text) {

        throw new Error(
            `Сервер вернул пустой ответ (HTTP ${response.status})`
        );
    }


    try {

        return JSON.parse(
            text
        );

    } catch (error) {

        console.error(
            "Некорректный JSON:",
            text
        );


        throw new Error(
            `Сервер вернул некорректный JSON (HTTP ${response.status})`
        );
    }
}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(
    value
) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );
}


// ============================================================
// SALES REPORT
// ============================================================

if (loadSalesButton) {

    loadSalesButton.addEventListener(
        "click",
        async function () {

            if (!iikoConnection) {

                salesResult.innerHTML = `

                    <div class="report-error">

                        ⚠️ Сначала подключитесь
                        к iiko Server

                    </div>

                `;

                return;
            }


            const from =
                document.getElementById(
                    "report-from"
                ).value;


            const to =
                document.getElementById(
                    "report-to"
                ).value;


            if (!from || !to) {

                salesResult.innerHTML = `

                    <div class="report-error">

                        ⚠️ Выберите период

                    </div>

                `;

                return;
            }


            if (from > to) {

                salesResult.innerHTML = `

                    <div class="report-error">

                        ⚠️ Дата начала
                        не может быть позже
                        даты окончания

                    </div>

                `;

                return;
            }


            loadSalesButton.disabled =
                true;

            loadSalesButton.textContent =
                "Загрузка...";


            salesResult.innerHTML = `

                <div class="report-loading">

                    ⏳ Получаем данные из iiko...

                </div>

            `;


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


                console.log(
                    "Ответ sales:",
                    data
                );


                if (
                    !response.ok ||
                    !data.success
                ) {

                    throw new Error(
                        data.message ||
                        "Ошибка получения отчёта"
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

                                ${money.format(
                                    totalSales
                                )}

                            </div>

                        </div>


                        <div class="report-card">

                            <div class="report-card-title">

                                🧾 Заказы

                            </div>

                            <div class="report-card-value">

                                ${number.format(
                                    totalOrders
                                )}

                            </div>

                        </div>


                        <div class="report-card">

                            <div class="report-card-title">

                                💵 Средний чек

                            </div>

                            <div class="report-card-value">

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

                    html += `

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


                            html += `

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


                html += `

                            </tbody>

                        </table>

                    </div>

                `;


                salesResult.innerHTML =
                    html;


            } catch (error) {

                console.error(
                    "Ошибка отчёта:",
                    error
                );


                salesResult.innerHTML = `

                    <div class="report-error">

                        🔴

                        ${escapeHtml(
                            error.message
                        )}

                    </div>

                `;

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

setDefaultOlapDates();
