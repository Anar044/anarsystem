// ==========================================
// IIKO REPORTS + OLAP CONSTRUCTOR
// ==========================================


// ==========================================
// ELEMENTS
// ==========================================

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


let iikoConnection = null;


// ==========================================
// STORAGE
// ==========================================

const IIKO_STORAGE_KEY =
    "iikoConnection";


// ==========================================
// OLAP STATE
// ==========================================

let olapFields = [];

let olapRows = [];

let olapMeasures = [];


// ==========================================
// LOAD SAVED IIKO DATA
// ==========================================

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


// ==========================================
// SAVE IIKO DATA
// ==========================================

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


// ==========================================
// CLEAR DATA
// ==========================================

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

        salesCard.style.display =
            "none";

        statusElement.textContent =
            "⚪ Данные удалены";

        salesResult.innerHTML = "";

        const builder =
            document.getElementById(
                "olap-builder"
            );

        if (builder) {
            builder.remove();
        }
    }
);


// ==========================================
// CONNECT IIKO
// ==========================================

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


            salesCard.style.display =
                "block";


            // Создаём OLAP конструктор
            createOlapBuilder();


            // Загружаем реальные поля
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


// ==========================================
// CREATE OLAP BUILDER
// ==========================================

function createOlapBuilder() {

    if (
        document.getElementById(
            "olap-builder"
        )
    ) {
        return;
    }


    const container =
        document.querySelector(
            ".reports-container"
        );


    const builder =
        document.createElement(
            "div"
        );


    builder.id =
        "olap-builder";

    builder.className =
        "olap-builder";


    builder.innerHTML = `

        <h2>
            🧩 Конструктор OLAP
        </h2>

        <div class="olap-description">

            Выберите реальные поля,
            которые доступны в iiko Server,
            и соберите собственный отчёт.

        </div>


        <!-- TOOLBAR -->

        <div class="olap-toolbar">

            <label>

                Тип показателя

                <select id="olap-measure-type">

                    <option value="SUM">
                        Сумма
                    </option>

                    <option value="COUNT">
                        Количество
                    </option>

                    <option value="AVG">
                        Среднее
                    </option>

                    <option value="MIN">
                        Минимум
                    </option>

                    <option value="MAX">
                        Максимум
                    </option>

                </select>

            </label>


            <button
                type="button"
                id="olap-refresh-fields"
            >
                🔄 Обновить поля
            </button>

        </div>


        <!-- STATUS -->

        <div
            id="olap-status"
            class="olap-status"
        >
            ⏳ Загрузка полей...
        </div>


        <!-- GRID -->

        <div class="olap-grid">


            <!-- AVAILABLE FIELDS -->

            <div class="olap-panel">

                <h3>
                    📚 Доступные поля
                </h3>


                <input
                    id="olap-search"
                    type="text"
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

            </div>


            <!-- SELECTED -->

            <div class="olap-panel">


                <h3>
                    📋 Строки
                </h3>


                <div
                    id="olap-rows"
                    class="olap-selected"
                >

                    <div class="olap-empty">

                        Нажмите на поле слева,
                        чтобы добавить его.

                    </div>

                </div>


                <h3>
                    📊 Показатели
                </h3>


                <div
                    id="olap-measures"
                    class="olap-selected"
                >

                    <div class="olap-empty">

                        Добавьте числовое поле
                        как показатель.

                    </div>

                </div>


                <!-- PERIOD -->

                <div class="olap-period">

                    <h3>
                        📅 Период
                    </h3>

                    <div>

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


                <button
                    type="button"
                    id="olap-run"
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


    // Search
    document
        .getElementById(
            "olap-search"
        )
        .addEventListener(
            "input",
            renderOlapFields
        );


    // Refresh
    document
        .getElementById(
            "olap-refresh-fields"
        )
        .addEventListener(
            "click",
            loadOlapFields
        );


    // Run
    document
        .getElementById(
            "olap-run"
        )
        .addEventListener(
            "click",
            runOlapReport
        );


    // Default dates
    setDefaultOlapDates();
}


// ==========================================
// DEFAULT DATES
// ==========================================

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


// ==========================================
// LOAD REAL OLAP FIELDS
// ==========================================

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


// ==========================================
// EXTRACT OLAP FIELDS
// ==========================================

function extractOlapFields(data) {

    /*
       Поддерживаем несколько вариантов
       ответа backend.

       Например:

       {
           success: true,
           fields: [...]
       }

       или:

       {
           success: true,
           data: [...]
       }

       или:

       {
           fields: {
               dimensions: [...],
               measures: [...]
           }
       }
    */


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


    /*
       Нормализуем поля.
    */

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


// ==========================================
// RENDER AVAILABLE FIELDS
// ==========================================

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

            const button =
                document.createElement(
                    "button"
                );


            button.type =
                "button";


            button.className =
                "olap-field";


            const typeText =
                field.type ||
                "unknown";


            button.innerHTML = `

                <span>

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

                <span class="olap-flags">

                    ${
                        field.isMeasure
                            ? "📊"
                            : "▤"
                    }

                </span>

            `;


            button.addEventListener(
                "click",
                function () {

                    addOlapField(
                        field
                    );

                }
            );


            container.appendChild(
                button
            );
        }
    );
}


// ==========================================
// ADD FIELD
// ==========================================

function addOlapField(field) {

    if (!field || !field.name) {
        return;
    }


    /*
       Если поле уже выбрано
       в строках — не добавляем повторно.
    */

    const alreadyRow =
        olapRows.some(
            item =>
                item.name ===
                field.name
        );


    const alreadyMeasure =
        olapMeasures.some(
            item =>
                item.name ===
                field.name
        );


    if (
        alreadyRow ||
        alreadyMeasure
    ) {

        return;
    }


    /*
       Числовые поля добавляем
       в показатели.

       Остальные — в строки.
    */

    if (
        field.isMeasure
    ) {

        olapMeasures.push({

            ...field,

            aggregation:
                getMeasureAggregation(
                    field
                )

        });

    } else {

        olapRows.push(
            field
        );
    }


    renderSelectedOlapFields();
}


// ==========================================
// MEASURE AGGREGATION
// ==========================================

function getMeasureAggregation(field) {

    const select =
        document.getElementById(
            "olap-measure-type"
        );


    if (
        select &&
        select.value
    ) {

        return select.value;
    }


    return "SUM";
}


// ==========================================
// RENDER SELECTED
// ==========================================

function renderSelectedOlapFields() {

    renderSelectedGroup(
        "olap-rows",
        olapRows,
        "rows"
    );


    renderSelectedGroup(
        "olap-measures",
        olapMeasures,
        "measures"
    );
}


// ==========================================
// RENDER GROUP
// ==========================================

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

        container.innerHTML = `

            <div class="olap-empty">

                ${
                    group === "rows"
                        ? "Нажмите на поле слева, чтобы добавить его."
                        : "Добавьте числовое поле как показатель."
                }

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
                "olap-selected-field";


            let aggregation =
                "";


            if (
                group ===
                "measures"
            ) {

                aggregation =
                    field.aggregation ||
                    "SUM";
            }


            item.innerHTML = `

                <span>

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
                                  escapeHtml(
                                      aggregation
                                  )
                                : ""
                        }

                    </small>

                </span>


                <button
                    type="button"
                    title="Удалить"
                >
                    ×
                </button>

            `;


            const removeButton =
                item.querySelector(
                    "button"
                );


            removeButton.addEventListener(
                "click",
                function () {

                    fields.splice(
                        index,
                        1
                    );

                    renderSelectedOlapFields();

                }
            );


            container.appendChild(
                item
            );
        }
    );
}


// ==========================================
// RUN OLAP REPORT
// ==========================================

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
        olapMeasures.length === 0
    ) {

        showOlapError(
            "Выберите хотя бы одно поле"
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

        /*
           Собираем запрос.

           Backend получает:

           ip
           port
           login
           password

           период

           rows

           measures
        */

        const payload = {

            ip:
                iikoConnection.ip,

            port:
                iikoConnection.port,

            login:
                iikoConnection.login,

            password:
                iikoConnection.password,

            from:
                from,

            to:
                to,

            rows:
                olapRows.map(
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
            await safeJson(response);


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


// ==========================================
// RENDER OLAP RESULT
// ==========================================

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


    /*
       Если backend возвращает rawResponse
       строкой — попробуем разобрать.
    */

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


    /*
       CARDS
    */

    const cards =
        createOlapSummaryCards(
            rows
        );


    if (cards) {

        html += cards;
    }


    /*
       TABLE
    */

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


    /*
       DEBUG
    */

    html += `

        <details style="
            margin-top:20px;
        ">

            <summary style="
                cursor:pointer;
                color:#555;
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


// ==========================================
// OLAP SUMMARY CARDS
// ==========================================

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

            Object.keys(row)
                .forEach(
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


    /*
       Максимум 3 карточки.
    */

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


// ==========================================
// OLAP TABLE
// ==========================================

function createOlapTable(
    rows
) {

    /*
       Собираем все ключи
       из всех строк.
    */

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

                Нет колонок для отображения.

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


// ==========================================
// FIELD TITLE
// ==========================================

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


// ==========================================
// FORMAT CELL
// ==========================================

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


// ==========================================
// FORMAT NUMBER
// ==========================================

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


// ==========================================
// FORMAT DATE
// ==========================================

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


// ==========================================
// OLAP ERROR
// ==========================================

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


// ==========================================
// SAFE JSON
// ==========================================

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


// ==========================================
// ESCAPE HTML
// ==========================================

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


// ==========================================
// SALES REPORT
// ==========================================

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

                                from:
                                    from,

                                to:
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


// ==========================================
// START
// ==========================================

loadSavedIikoData();
