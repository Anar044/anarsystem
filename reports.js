// ============================================================
// ANAR SYSTEM — REPORTS + IIKO OLAP CONSTRUCTOR
// reports.js
// ============================================================

(function () {

    "use strict";

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
    // IIKO CONNECTION
    // ============================================================

    let iikoConnection = null;

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

    // Текущее перетаскиваемое поле OLAP.
    let currentOlapDragData = null;

    // Информация о последнем запросе нужна для правильного
    // отображения и агрегации результата OLAP.
    let lastOlapQueryMeta = null;


    // ============================================================
    // STANDARD IIKO SALES OLAP FIELDS
    // ============================================================

    const STANDARD_IIKO_FIELDS = [

        {
            name: "OpenDate.Typed",
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
            name: "UniqOrderId",
            title: "ID заказа",
            type: "number",
            isMeasure: true
        },

        {
            name: "OrderNum",
            title: "Номер заказа",
            type: "number",
            isMeasure: false
        },

        {
            name: "DishName",
            title: "Блюдо",
            type: "string",
            isMeasure: false
        },

        {
            name: "DishId",
            title: "ID блюда",
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
            title: "Группа блюда",
            type: "string",
            isMeasure: false
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
            title: "Сумма со скидкой",
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
            name: "DishCost",
            title: "Себестоимость",
            type: "number",
            isMeasure: true
        },

        {
            name: "Department",
            title: "Подразделение",
            type: "string",
            isMeasure: false
        },

        {
            name: "Department.Id",
            title: "ID подразделения",
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
            name: "Department.Name",
            title: "Название подразделения",
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
            name: "Waiter",
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
            name: "GuestNum",
            title: "Количество гостей",
            type: "number",
            isMeasure: true
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
            name: "Delivery",
            title: "Доставка",
            type: "string",
            isMeasure: false
        },

        {
            name: "OrderSource",
            title: "Источник заказа",
            type: "string",
            isMeasure: false
        }

    ];


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

        const text =
            await response.text();

        if (!text) {
            return {};
        }

        try {

            return JSON.parse(text);

        } catch (error) {

            return {

                success: false,

                message:
                    text.slice(0, 2000),

                rawText:
                    text

            };
        }
    }


    function getElement(id) {

        return document.getElementById(id);
    }


    function todayString() {

        const date =
            new Date();

        const yyyy =
            date.getFullYear();

        const mm =
            String(
                date.getMonth() + 1
            ).padStart(2, "0");

        const dd =
            String(
                date.getDate()
            ).padStart(2, "0");

        return `${yyyy}-${mm}-${dd}`;
    }


    function formatDate(value) {

        if (!value) {
            return "";
        }

        const parts =
            String(value)
                .slice(0, 10)
                .split("-");

        if (parts.length !== 3) {
            return String(value);
        }

        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }


    function formatNumber(value) {

        const number =
            Number(value);

        if (!Number.isFinite(number)) {
            return escapeHtml(value);
        }

        return new Intl.NumberFormat(
            "ru-RU",
            {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }
        ).format(number);
    }


    function formatMoney(value) {

        const number =
            Number(value);

        if (!Number.isFinite(number)) {
            return "0,00";
        }

        return new Intl.NumberFormat(
            "ru-RU",
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        ).format(number);
    }


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
                rememberIiko.checked =
                    true;
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
    // CLEAR SAVED IIKO DATA
    // ============================================================

    function clearSavedIikoData() {

        try {

            localStorage.removeItem(
                IIKO_STORAGE_KEY
            );

        } catch (error) {

            console.error(
                error
            );
        }


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
            salesCard.style.display = "none";
        }


        if (statusElement) {

            statusElement.textContent =
                "⚪ Не подключено";
        }
    }


    // ============================================================
    // STATUS
    // ============================================================

    function setIikoStatus(
        text
    ) {

        if (!statusElement) {
            return;
        }

        statusElement.textContent =
            text;
    }


    // ============================================================
    // NORMALIZE FIELD
    // ============================================================

    function normalizeOlapField(
        field
    ) {

        if (!field) {
            return null;
        }


        if (
            typeof field === "string"
        ) {

            const name =
                field.trim();

            if (!name) {
                return null;
            }

            return {

                name,

                field:
                    name,

                key:
                    name,

                title:
                    name,

                type:
                    "",

                isMeasure:
                    false,

                aggregationAllowed:
                    false,

                groupingAllowed:
                    true,

                filteringAllowed:
                    true
            };
        }


        if (
            typeof field !== "object"
        ) {

            return null;
        }


        const name =
            String(
                field.name ||
                field.field ||
                field.key ||
                field.technicalName ||
                field.code ||
                field.id ||
                ""
            ).trim();


        if (!name) {
            return null;
        }


        const title =
            String(
                field.title ||
                field.caption ||
                field.label ||
                field.displayName ||
                field.name ||
                name
            ).trim();


        return {

            ...field,

            name,

            field:
                name,

            key:
                name,

            title,

            type:
                String(
                    field.type ||
                    field.dataType ||
                    field.kind ||
                    ""
                ),

            isMeasure:
                field.isMeasure === true ||
                field.measure === true ||
                field.aggregationAllowed === true,

            aggregationAllowed:
                field.aggregationAllowed === true ||
                field.allowAggregation === true ||
                field.canAggregate === true,

            groupingAllowed:
                field.groupingAllowed !== false,

            filteringAllowed:
                field.filteringAllowed !== false
        };
    }


    // ============================================================
    // EXTRACT OLAP FIELDS
    // ============================================================

    function extractOlapFields(
        data
    ) {

        const result = [];

        const seen =
            new Set();


        function addField(
            field,
            fallbackName = ""
        ) {

            if (!field) {
                return;
            }


            let name = "";
            let title = "";
            let type = "";


            if (
                typeof field === "string"
            ) {

                name =
                    field;

                title =
                    field;

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
                    fallbackName ||
                    "";

                title =
                    field.title ||
                    field.caption ||
                    field.label ||
                    field.displayName ||
                    field.name ||
                    name;

                type =
                    field.type ||
                    field.dataType ||
                    field.kind ||
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


            result.push({

                ...(
                    typeof field === "object"
                        ? field
                        : {}
                ),

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

                isMeasure:
                    field &&
                    typeof field === "object"
                        ? (
                            field.isMeasure === true ||
                            field.measure === true ||
                            field.aggregationAllowed === true
                        )
                        : false,

                aggregationAllowed:
                    field &&
                    typeof field === "object"
                        ? (
                            field.aggregationAllowed === true ||
                            field.allowAggregation === true ||
                            field.canAggregate === true
                        )
                        : false,

                groupingAllowed:
                    field &&
                    typeof field === "object"
                        ? field.groupingAllowed !== false
                        : true,

                filteringAllowed:
                    field &&
                    typeof field === "object"
                        ? field.filteringAllowed !== false
                        : true
            });
        }


        function parseArray(
            array
        ) {

            if (!Array.isArray(array)) {
                return;
            }


            array.forEach(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        addField(
                            item
                        );

                        return;
                    }


                    if (
                        item &&
                        typeof item === "object"
                    ) {

                        addField(
                            item
                        );
                    }
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
            ).forEach(
                ([key, value]) => {

                    if (
                        [
                            "fields",
                            "columns",
                            "items",
                            "data",
                            "dimensions",
                            "measures",
                            "fieldDefinitions"
                        ].includes(key)
                    ) {
                        return;
                    }


                    if (
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                    ) {

                        addField(
                            value,
                            key
                        );
                    }
                }
            );
        }


        if (!data) {
            return [];
        }


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


        if (
            !result.length
        ) {

            if (
                Array.isArray(data)
            ) {

                parseArray(
                    data
                );

            } else if (
                typeof data === "object"
            ) {

                parseObject(
                    data
                );
            }
        }


        return result;
    }


    // ============================================================
    // TECHNICAL FIELD RESOLVER
    //
    // ГЛАВНОЕ ИСПРАВЛЕНИЕ:
    //
    // "Сумма со скидкой"
    //          ↓
    // "DishDiscountSumInt"
    //
    // В iiko НЕЛЬЗЯ отправлять title.
    // Нужно отправлять техническое name.
    // ============================================================

    function resolveTechnicalOlapFieldName(
        fieldOrName
    ) {

        if (
            fieldOrName &&
            typeof fieldOrName === "object"
        ) {

            const directTechnicalName =
                fieldOrName.technicalName ||
                fieldOrName.field ||
                fieldOrName.key ||
                fieldOrName.code ||
                fieldOrName.id;


            if (
                directTechnicalName &&
                typeof directTechnicalName === "string"
            ) {

                const direct =
                    directTechnicalName.trim();

                if (direct) {

                    const directField =
                        olapFields.find(
                            field =>
                                String(
                                    field.name || ""
                                ) === direct
                        );


                    if (directField) {
                        return directField.name;
                    }


                    // Если поле уже явно является техническим
                    // именем — оставляем его.
                    if (
                        direct.includes(".") ||
                        /^[A-Za-z0-9_]+$/.test(direct)
                    ) {

                        return direct;
                    }
                }
            }


            fieldOrName =
                fieldOrName.name ||
                fieldOrName.title ||
                "";
        }


        const value =
            String(
                fieldOrName || ""
            ).trim();


        if (!value) {
            return "";
        }


        // --------------------------------------------------------
        // Сначала точное совпадение технического имени
        // --------------------------------------------------------

        const exact =
            olapFields.find(
                field =>
                    String(
                        field.name || ""
                    ).trim() === value
            );


        if (exact) {
            return exact.name;
        }


        // --------------------------------------------------------
        // Потом совпадение title
        // --------------------------------------------------------

        const lower =
            value.toLowerCase();


        const byTitle =
            olapFields.find(
                field =>
                    String(
                        field.title || ""
                    )
                        .trim()
                        .toLowerCase() === lower
            );


        if (byTitle) {

            console.warn(
                "OLAP: display name converted to technical name:",
                value,
                "=>",
                byTitle.name
            );


            return byTitle.name;
        }


        // --------------------------------------------------------
        // Дополнительные гарантированные стандартные поля
        // --------------------------------------------------------

        const standard =
            STANDARD_IIKO_FIELDS.find(
                field =>
                    String(
                        field.title || ""
                    )
                        .trim()
                        .toLowerCase() === lower
            );


        if (standard) {

            console.warn(
                "OLAP: standard display name converted:",
                value,
                "=>",
                standard.name
            );


            return standard.name;
        }


        // --------------------------------------------------------
        // Важно:
        // не отправляем русское display-name как техническое,
        // если можем определить известное поле.
        // --------------------------------------------------------

        const aliases = {

            "сумма со скидкой":
                "DishDiscountSumInt",

            "скидка":
                "DishDiscountSumInt",

            "сумма":
                "DishSumInt",

            "сумма после скидки":
                "DishSumAfterDiscount",

            "количество":
                "DishAmountInt",

            "блюдо":
                "DishName",

            "категория блюда":
                "DishCategory",

            "группа блюда":
                "DishGroup",

            "дата открытия":
                "OpenDate.Typed",

            "дата закрытия":
                "CloseDate.Typed",

            "официант":
                "WaiterName",

            "кассир":
                "CashierName",

            "подразделение":
                "Department.Name",

            "стол":
                "TableName",

            "тип оплаты":
                "PaymentType.Name",

            "тип заказа":
                "OrderType.Name",

            "источник заказа":
                "OrderSource"
        };


        if (
            aliases[lower]
        ) {

            return aliases[lower];
        }


        // Если значение уже выглядит как техническое поле,
        // оставляем его без изменения.

        return value;
    }


    // ============================================================
    // FIELD LOOKUP
    // ============================================================

    function findOlapField(
        fieldOrName
    ) {

        const technicalName =
            resolveTechnicalOlapFieldName(
                fieldOrName
            );


        if (!technicalName) {
            return null;
        }


        return (
            olapFields.find(
                field =>
                    String(
                        field.name || ""
                    ) === technicalName
            ) ||

            STANDARD_IIKO_FIELDS.find(
                field =>
                    String(
                        field.name || ""
                    ) === technicalName
            ) ||

            null
        );
    }


    // ============================================================
    // API: LOAD OLAP FIELDS
    // ============================================================

    async function loadOlapFields() {

        if (!iikoConnection) {

            throw new Error(
                "Сначала подключитесь к iiko"
            );
        }


        const response =
            await fetch(
                "/api/iiko/olap",
                {

                    method:
                        "POST",

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
            "OLAP FIELDS RESPONSE:",
            data
        );


        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(

                data.message ||

                `Ошибка OLAP fields HTTP ${response.status}`
            );
        }


        const extracted =
            extractOlapFields(
                data
            );


        if (extracted.length) {

            olapFields =
                extracted;

        } else {

            olapFields =
                STANDARD_IIKO_FIELDS.map(
                    normalizeOlapField
                );
        }


        console.log(
            "🟢 Доступные поля OLAP:",
            olapFields.length
        );


        return olapFields;
    }


    // ============================================================
    // CREATE OLAP BUILDER
    // ============================================================

    function createOlapBuilder() {

        const existing =
            document.getElementById(
                "olap-builder"
            );


        if (existing) {
            return existing;
        }


        const container =
            document.querySelector(
                ".reports-container"
            );


        if (!container) {
            return null;
        }


        const builder =
            document.createElement(
                "div"
            );


        builder.id =
            "olap-builder";


        builder.innerHTML = `

            <div class="olap-builder">

                <h2>
                    Конструктор OLAP
                </h2>

                <div class="olap-description">
                    Перетащите поле из списка слева в Строки, Колонки или Показатели.
                    В запрос iiko будут отправляться технические имена полей.
                </div>


                <div class="olap-toolbar">

                    <label>

                        Поиск поля

                        <input
                            id="olap-search"
                            type="text"
                            placeholder="Например: сумма, блюдо, официант..."
                        >

                    </label>


                    <button
                        type="button"
                        id="olap-refresh-fields"
                    >
                        Обновить поля
                    </button>


                    <button
                        type="button"
                        id="olap-clear"
                    >
                        Очистить
                    </button>

                </div>


                <div
                    id="olap-status"
                    class="olap-status"
                >
                    ⚪ Поля ещё не загружены
                </div>


                <div class="olap-grid">


                    <div class="olap-panel">

                        <h3>
                            Доступные поля
                        </h3>


                        <div
                            id="olap-fields"
                            class="olap-fields"
                        >

                            <div class="olap-empty">
                                Поля отсутствуют
                            </div>

                        </div>

                    </div>


                    <div class="olap-panel">

                        <h3>
                            Строки
                        </h3>


                        <div
                            id="olap-rows"
                            class="olap-selected"
                        >

                            <div class="olap-empty">
                                Перетащите поле сюда
                            </div>

                        </div>


                        <h3>
                            Колонки
                        </h3>


                        <div
                            id="olap-columns"
                            class="olap-selected"
                        >

                            <div class="olap-empty">
                                Перетащите поле сюда
                            </div>

                        </div>


                        <h3>
                            Показатели
                        </h3>


                        <div
                            id="olap-measures"
                            class="olap-selected"
                        >

                            <div class="olap-empty">
                                Перетащите поле сюда
                            </div>

                        </div>

                    </div>

                </div>


                <div class="olap-filters-panel">

                    <h3>Фильтры</h3>

                    <div class="olap-filter-editor">

                        <label>
                            Поле
                            <select id="olap-filter-field"></select>
                        </label>

                        <label>
                            Условие
                            <select id="olap-filter-operator">
                                <option value="Include">Равно</option>
                                <option value="Exclude">Не равно</option>
                                <option value="IncludeList">В списке</option>
                                <option value="ExcludeList">Не в списке</option>
                                <option value="DateRange">Диапазон дат</option>
                            </select>
                        </label>

                        <label id="olap-filter-value-label" class="olap-filter-value-wrap">
                            Значение
                            <input id="olap-filter-value" type="text" placeholder="Например: Ресторан №1">
                        </label>

                        <label id="olap-filter-from-label" class="olap-filter-date-wrap" style="display:none">
                            От
                            <input id="olap-filter-from" type="date">
                        </label>

                        <label id="olap-filter-to-label" class="olap-filter-date-wrap" style="display:none">
                            До
                            <input id="olap-filter-to" type="date">
                        </label>

                        <button type="button" id="olap-add-filter">+ Добавить фильтр</button>

                    </div>

                    <div id="olap-filters" class="olap-filters-list">
                        <div class="olap-empty">Фильтры не заданы</div>
                    </div>

                </div>


                <div class="olap-period">

                    <h3>
                        Период
                    </h3>


                    <div>

                        <label>

                            От

                            <input
                                id="olap-from"
                                type="date"
                            >

                        </label>


                        <label>

                            До

                            <input
                                id="olap-to"
                                type="date"
                            >

                        </label>

                    </div>

                </div>


                <button
                    type="button"
                    id="olap-run"
                >
                    Выполнить OLAP отчёт
                </button>


                <div
                    id="olap-result"
                    class="olap-result"
                ></div>

            </div>

        `;


        container.appendChild(
            builder
        );


        bindOlapEvents();


        return builder;
    }


    // ============================================================
    // OLAP STATUS
    // ============================================================

    function setOlapStatus(
        text
    ) {

        const element =
            getElement(
                "olap-status"
            );


        if (element) {
            element.textContent =
                text;
        }
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


        const searchElement =
            getElement(
                "olap-search"
            );


        const search =
            searchElement
                ? searchElement.value
                    .trim()
                    .toLowerCase()
                : "";


        const filtered =
            olapFields.filter(
                field => {

                    if (!search) {
                        return true;
                    }


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


                    return (
                        name.includes(search) ||
                        title.includes(search)
                    );
                }
            );


        if (!filtered.length) {

            container.innerHTML = `

                <div class="olap-empty">
                    Поля не найдены
                </div>

            `;

            return;
        }


        container.innerHTML =
            filtered.map(
                field => {

                    const technicalName =
                        resolveTechnicalOlapFieldName(
                            field
                        );


                    const measure =
                        field.isMeasure ||
                        field.aggregationAllowed;


                    const flags = [];


                    if (
                        field.groupingAllowed !== false
                    ) {
                        flags.push("Г");
                    }


                    if (
                        measure
                    ) {
                        flags.push("Σ");
                    }


                    if (
                        field.filteringAllowed !== false
                    ) {
                        flags.push("Ф");
                    }


                    return `

                        <button
                            type="button"
                            class="olap-field"
                            data-field="${escapeHtml(
                                technicalName
                            )}"
                        >

                            <span>

                                <strong>
                                    ${escapeHtml(
                                        field.title ||
                                        field.name
                                    )}
                                </strong>

                                <small>
                                    ${escapeHtml(
                                        technicalName
                                    )}
                                </small>

                            </span>


                            <span class="olap-flags">
                                ${escapeHtml(
                                    flags.join(" ")
                                )}
                            </span>

                        </button>

                    `;
                }
            )
            .join("");


        container
            .querySelectorAll(".olap-field")
            .forEach(button => {
                button.setAttribute("draggable", "true");

                button.addEventListener("dragstart", event => {
                    const fieldName = button.dataset.field || "";

                    currentOlapDragData = {
                        sourceType: "available",
                        sourceIndex: -1,
                        field: fieldName
                    };

                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                        "application/x-anar-olap",
                        JSON.stringify(currentOlapDragData)
                    );

                    button.classList.add("olap-dragging");
                });

                button.addEventListener("dragend", () => {
                    button.classList.remove("olap-dragging");
                    currentOlapDragData = null;
                    clearOlapDropHighlights();
                });
            });
    }


    // ============================================================
    // ADD / MOVE OLAP FIELD
    // ============================================================

    function removeFieldFromOtherGroups(fieldName, keepType) {

        const technicalName =
            resolveTechnicalOlapFieldName(fieldName);

        if (!technicalName) {
            return;
        }

        if (keepType !== "rows") {
            olapRows = olapRows.filter(
                field => resolveTechnicalOlapFieldName(field) !== technicalName
            );
        }

        if (keepType !== "columns") {
            olapColumns = olapColumns.filter(
                field => resolveTechnicalOlapFieldName(field) !== technicalName
            );
        }

        if (keepType !== "measures") {
            olapMeasures = olapMeasures.filter(
                item => resolveTechnicalOlapFieldName(item.field) !== technicalName
            );
        }
    }


    function addOlapRow(fieldName) {

        const technicalName =
            resolveTechnicalOlapFieldName(fieldName);

        if (!technicalName) {
            return;
        }

        removeFieldFromOtherGroups(technicalName, "rows");

        if (!olapRows.includes(technicalName)) {
            olapRows.push(technicalName);
        }

        renderSelectedOlapFields();
    }


    function addOlapColumn(fieldName) {

        const technicalName =
            resolveTechnicalOlapFieldName(fieldName);

        if (!technicalName) {
            return;
        }

        removeFieldFromOtherGroups(technicalName, "columns");

        if (!olapColumns.includes(technicalName)) {
            olapColumns.push(technicalName);
        }

        renderSelectedOlapFields();
    }


    function addOlapMeasure(fieldName, aggregation = "SUM") {

        const technicalName =
            resolveTechnicalOlapFieldName(fieldName);

        if (!technicalName) {
            return;
        }

        const field = findOlapField(technicalName);

        if (field && field.aggregationAllowed === false && !field.isMeasure) {
            return;
        }

        removeFieldFromOtherGroups(technicalName, "measures");

        const exists = olapMeasures.some(
            item => item.field === technicalName
        );

        if (!exists) {
            olapMeasures.push({
                field: technicalName,
                aggregation
            });
        }

        renderSelectedOlapFields();
    }


    function getOlapDragData(event) {

        if (currentOlapDragData) {
            return currentOlapDragData;
        }

        try {
            const raw = event && event.dataTransfer
                ? event.dataTransfer.getData("application/x-anar-olap")
                : "";

            if (raw) {
                return JSON.parse(raw);
            }
        } catch (error) {
            console.warn("OLAP drag data error:", error);
        }

        return null;
    }


    function clearOlapDropHighlights() {
        document
            .querySelectorAll("#olap-builder .olap-drop-active")
            .forEach(element => element.classList.remove("olap-drop-active"));
    }


    function bindOlapDropZones() {

        const zones = [
            ["olap-rows", "rows"],
            ["olap-columns", "columns"],
            ["olap-measures", "measures"]
        ];

        zones.forEach(([elementId, targetType]) => {

            const zone = getElement(elementId);

            if (!zone || zone.dataset.olapDropBound === "1") {
                return;
            }

            zone.dataset.olapDropBound = "1";

            zone.addEventListener("dragover", event => {
                const data = getOlapDragData(event);

                if (!data || !data.field) {
                    return;
                }

                const field = findOlapField(data.field);

                if (targetType === "measures" && field && field.aggregationAllowed === false && !field.isMeasure) {
                    event.dataTransfer.dropEffect = "none";
                    return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = data.sourceType === "available" ? "copy" : "move";
                zone.classList.add("olap-drop-active");
            });

            zone.addEventListener("dragleave", event => {
                if (!zone.contains(event.relatedTarget)) {
                    zone.classList.remove("olap-drop-active");
                }
            });

            zone.addEventListener("drop", event => {
                event.preventDefault();
                clearOlapDropHighlights();

                const data = getOlapDragData(event);

                if (!data || !data.field) {
                    return;
                }

                const field = findOlapField(data.field);

                if (targetType === "measures" && field && field.aggregationAllowed === false && !field.isMeasure) {
                    return;
                }

                if (targetType === "rows") {
                    addOlapRow(data.field);
                } else if (targetType === "columns") {
                    addOlapColumn(data.field);
                } else {
                    addOlapMeasure(data.field, "SUM");
                }

                currentOlapDragData = null;
            });
        });
    }


    // ============================================================
    // REMOVE FIELD
    // ============================================================

    function removeOlapField(
        type,
        index
    ) {

        if (type === "rows") {
            olapRows.splice(index, 1);
        }

        if (type === "columns") {
            olapColumns.splice(index, 1);
        }

        if (type === "measures") {
            olapMeasures.splice(index, 1);
        }

        renderSelectedOlapFields();
    }


    // ============================================================
    // OLAP FILTERS
    // ============================================================

    function getFilterableOlapFields() {

        return olapFields.filter(
            field => field && field.filteringAllowed !== false
        );
    }


    function renderOlapFilterEditor() {

        const select = getElement("olap-filter-field");

        if (!select) {
            return;
        }

        const current = select.value;

        const fields = getFilterableOlapFields();

        select.innerHTML = fields.length
            ? fields.map(field => {
                const name = resolveTechnicalOlapFieldName(field);
                return `<option value="${escapeHtml(name)}">${escapeHtml(field.title || name)}</option>`;
            }).join("")
            : `<option value="">Нет доступных полей</option>`;

        if (fields.some(field => resolveTechnicalOlapFieldName(field) === current)) {
            select.value = current;
        }

        updateOlapFilterInputMode();
    }


    function updateOlapFilterInputMode() {

        const operator = getElement("olap-filter-operator");
        const valueLabel = getElement("olap-filter-value-label");
        const fromLabel = getElement("olap-filter-from-label");
        const toLabel = getElement("olap-filter-to-label");

        const isDateRange = operator && operator.value === "DateRange";

        if (valueLabel) {
            valueLabel.style.display = isDateRange ? "none" : "block";
        }

        if (fromLabel) {
            fromLabel.style.display = isDateRange ? "block" : "none";
        }

        if (toLabel) {
            toLabel.style.display = isDateRange ? "block" : "none";
        }

        const value = getElement("olap-filter-value");

        if (value) {
            value.placeholder = operator &&
                (operator.value === "IncludeList" || operator.value === "ExcludeList")
                ? "Несколько значений через запятую"
                : "Например: Ресторан №1";
        }
    }


    function renderOlapFilters() {

        const container = getElement("olap-filters");

        if (!container) {
            return;
        }

        if (!olapFilters.length) {
            container.innerHTML = `<div class="olap-empty">Фильтры не заданы</div>`;
            return;
        }

        container.innerHTML = olapFilters.map((filter, index) => {

            const field = findOlapField(filter.field);
            const title = field ? field.title : filter.field;
            let condition = "Равно";
            let value = filter.value || "";

            if (filter.operator === "Exclude") condition = "Не равно";
            if (filter.operator === "IncludeList") {
                condition = "В списке";
                value = (filter.values || []).join(", ");
            }
            if (filter.operator === "ExcludeList") {
                condition = "Не в списке";
                value = (filter.values || []).join(", ");
            }
            if (filter.operator === "DateRange") {
                condition = "Диапазон";
                value = `${filter.from || ""} — ${filter.to || ""}`;
            }

            return `
                <div class="olap-filter-item">
                    <div>
                        <strong>${escapeHtml(title)}</strong>
                        <small>${escapeHtml(condition)} • ${escapeHtml(value)}</small>
                    </div>
                    <button type="button" data-filter-index="${index}" title="Удалить">×</button>
                </div>
            `;
        }).join("");

        container.querySelectorAll("[data-filter-index]").forEach(button => {
            button.addEventListener("click", () => {
                const index = Number(button.dataset.filterIndex);
                olapFilters.splice(index, 1);
                renderOlapFilters();
            });
        });
    }


    function addOlapFilter() {

        const fieldElement = getElement("olap-filter-field");
        const operatorElement = getElement("olap-filter-operator");
        const valueElement = getElement("olap-filter-value");
        const fromElement = getElement("olap-filter-from");
        const toElement = getElement("olap-filter-to");

        const field = resolveTechnicalOlapFieldName(fieldElement ? fieldElement.value : "");
        const operator = operatorElement ? operatorElement.value : "Include";

        if (!field) {
            throw new Error("Выберите поле для фильтра");
        }

        if (operator === "DateRange") {

            const from = fromElement ? fromElement.value : "";
            const to = toElement ? toElement.value : "";

            if (!from || !to) {
                throw new Error("Укажите обе даты фильтра");
            }

            if (from > to) {
                throw new Error("Дата 'От' не может быть больше даты 'До'");
            }

            olapFilters.push({ field, operator, from, to });

        } else {

            const raw = valueElement ? valueElement.value.trim() : "";

            if (!raw) {
                throw new Error("Укажите значение фильтра");
            }

            const listMode = operator === "IncludeList" || operator === "ExcludeList";
            const values = listMode
                ? raw.split(/[,\n;]+/).map(value => value.trim()).filter(Boolean)
                : [raw];

            if (!values.length) {
                throw new Error("Укажите хотя бы одно значение фильтра");
            }

            olapFilters.push({
                field,
                operator: listMode
                    ? (operator === "IncludeList" ? "IncludeList" : "ExcludeList")
                    : operator,
                value: values[0],
                values
            });
        }

        if (valueElement) valueElement.value = "";
        if (fromElement) fromElement.value = "";
        if (toElement) toElement.value = "";

        renderOlapFilters();
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

        renderOlapFilters();
    }


    function renderSelectedGroup(
        elementId,
        values,
        type
    ) {

        const container =
            getElement(
                elementId
            );


        if (!container) {
            return;
        }


        if (!values.length) {

            container.innerHTML = `

                <div class="olap-empty">
                    Перетащите поле сюда
                </div>

            `;

            return;
        }


        container.innerHTML =
            values.map(
                (value, index) => {

                    const technicalName =
                        type === "measures"

                            ? resolveTechnicalOlapFieldName(
                                value.field
                            )

                            : resolveTechnicalOlapFieldName(
                                value
                            );


                    const field =
                        findOlapField(
                            technicalName
                        );


                    const title =
                        field
                            ? field.title
                            : technicalName;


                    const aggregation =
                        type === "measures"

                            ? value.aggregation ||
                                "SUM"

                            : "";


                    return `

                        <div
                            class="olap-selected-field"
                            draggable="true"
                            data-drag-type="${escapeHtml(type)}"
                            data-drag-index="${index}"
                        >

                            <span>

                                <strong>
                                    ${escapeHtml(
                                        title
                                    )}
                                </strong>

                                <small>
                                    ${escapeHtml(
                                        technicalName
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
                                data-type="${escapeHtml(
                                    type
                                )}"
                                data-index="${index}"
                            >
                                ×
                            </button>

                        </div>

                    `;
                }
            )
            .join("");


        container
            .querySelectorAll(".olap-selected-field[draggable=\"true\"]")
            .forEach(item => {
                item.addEventListener("dragstart", event => {
                    const sourceType = item.dataset.dragType || type;
                    const sourceIndex = Number(item.dataset.dragIndex);
                    const sourceValue =
                        sourceType === "measures"
                            ? olapMeasures[sourceIndex]?.field
                            : sourceType === "rows"
                                ? olapRows[sourceIndex]
                                : olapColumns[sourceIndex];

                    if (!sourceValue) {
                        return;
                    }

                    currentOlapDragData = {
                        sourceType,
                        sourceIndex,
                        field: sourceValue
                    };

                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                        "application/x-anar-olap",
                        JSON.stringify(currentOlapDragData)
                    );

                    item.classList.add("olap-dragging");
                });

                item.addEventListener("dragend", () => {
                    item.classList.remove("olap-dragging");
                    currentOlapDragData = null;
                    clearOlapDropHighlights();
                });
            });


        container
            .querySelectorAll(
                "button[data-index]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        function () {

                            removeOlapField(

                                this.dataset.type,

                                Number(
                                    this.dataset.index
                                )
                            );
                        }
                    );
                }
            );
    }


    // ============================================================
    // CLEAR OLAP
    // ============================================================

    function clearOlap() {

        olapRows = [];

        olapColumns = [];

        olapMeasures = [];

        olapFilters = [];

        renderSelectedOlapFields();


        const result =
            getElement(
                "olap-result"
            );


        if (result) {
            result.innerHTML = "";
        }
    }


    // ============================================================
    // OLAP QUERY
    // ============================================================

    async function runOlap() {

        if (!iikoConnection) {

            throw new Error(
                "Сначала подключитесь к iiko"
            );
        }


        const fromElement =
            getElement(
                "olap-from"
            );

        const toElement =
            getElement(
                "olap-to"
            );


        const from =
            fromElement
                ? fromElement.value
                : "";


        const to =
            toElement
                ? toElement.value
                : "";


        // --------------------------------------------------------
        // КРИТИЧЕСКИ ВАЖНО:
        // ещё раз переводим абсолютно ВСЕ поля
        // в технические имена непосредственно перед fetch.
        // --------------------------------------------------------

        const technicalRows =
            olapRows
                .map(
                    field =>
                        resolveTechnicalOlapFieldName(
                            field
                        )
                )
                .filter(Boolean);


        const technicalColumns =
            olapColumns
                .map(
                    field =>
                        resolveTechnicalOlapFieldName(
                            field
                        )
                )
                .filter(Boolean);


        let technicalMeasures =
            olapMeasures
                .map(
                    item => ({

                        field:
                            resolveTechnicalOlapFieldName(
                                item
                                    ? item.field
                                    : ""
                            ),

                        aggregation:
                            item &&
                            item.aggregation
                                ? item.aggregation
                                : "SUM"
                    })
                )
                .filter(
                    item =>
                        Boolean(
                            item.field
                        )
                );


        // --------------------------------------------------------
        // ЧИСЛОВЫЕ ПОЛЯ С АГРЕГАЦИЕЙ НЕ ДОЛЖНЫ ПОПАДАТЬ
        // В groupByColumnFields.
        //
        // Если пользователь положил "Количество блюд" в Колонки,
        // техническое поле DishAmountInt нельзя отправлять iiko
        // как GROUP BY. Иначе iiko разделит:
        //
        //   cola  1
        //   cola 10
        //
        // на две группы.
        //
        // Правильно:
        //
        //   groupByColumnFields:
        //       DishName, DishCode
        //
        //   measures:
        //       DishAmountInt (SUM)
        //       DishDiscountSumInt (SUM)
        //
        // Поэтому известные агрегируемые поля автоматически
        // переносим из колонок в показатели.
        // --------------------------------------------------------

        const columnMeasureFields = new Set(
            [
                "DishAmountInt",
                "DishDiscountSumInt",
                "DishSumInt",
                "DishSumAfterDiscount",
                "DishDiscountSumInt.withoutVAT",
                "DishSumInt.withoutVAT",
                "DishSumAfterDiscount.withoutVAT"
            ]
        );

        const promotedColumnMeasures = [];

        const filteredTechnicalColumns =
            technicalColumns.filter(
                field => {

                    if (
                        columnMeasureFields.has(
                            field
                        )
                    ) {
                        promotedColumnMeasures.push(
                            field
                        );
                        return false;
                    }

                    return true;
                }
            );

        technicalColumns.length = 0;
        technicalColumns.push(
            ...filteredTechnicalColumns
        );

        promotedColumnMeasures.forEach(
            field => {

                const alreadyMeasure =
                    technicalMeasures.some(
                        item =>
                            item.field === field
                    );

                if (!alreadyMeasure) {
                    technicalMeasures.push({
                        field,
                        aggregation: "SUM"
                    });
                }
            }
        );


        // --------------------------------------------------------
        // ВАЖНО: блюдо группируем НЕ по названию.
        //
        // Если пользователь выбрал "Блюдо", автоматически добавляем
        // DishCode в тот же набор группировки. DishCode не показываем
        // в таблице, но именно он определяет, являются ли две строки
        // одним и тем же блюдом.
        //
        // Поэтому:
        //   10542 / cola / 1
        //   10542 / cola / 10
        //
        // объединяются, а:
        //   10542 / cola / 1
        //   20781 / cola / 10
        //
        // остаются двумя разными блюдами.
        // --------------------------------------------------------

        const hiddenTechnicalFields = [];

        const hasDishNameInRows =
            technicalRows.includes(
                "DishName"
            );

        const hasDishNameInColumns =
            technicalColumns.includes(
                "DishName"
            );

        const dishCodeAlreadySelected =
            technicalRows.includes(
                "DishCode"
            ) ||
            technicalColumns.includes(
                "DishCode"
            );

        if (
            (hasDishNameInRows ||
             hasDishNameInColumns) &&
            !dishCodeAlreadySelected
        ) {

            if (hasDishNameInRows) {

                technicalRows.push(
                    "DishCode"
                );

                hiddenTechnicalFields.push(
                    "DishCode"
                );
            }

            else if (hasDishNameInColumns) {

                technicalColumns.push(
                    "DishCode"
                );

                hiddenTechnicalFields.push(
                    "DishCode"
                );
            }
        }


        console.log(
            "OLAP TECHNICAL ROWS:",
            technicalRows
        );


        console.log(
            "OLAP TECHNICAL COLUMNS:",
            technicalColumns
        );


        console.log(
            "OLAP TECHNICAL MEASURES:",
            technicalMeasures
        );


        if (
            technicalRows.length === 0 &&
            technicalColumns.length === 0 &&
            technicalMeasures.length === 0
        ) {

            throw new Error(
                "Выберите хотя бы одно поле"
            );
        }


        lastOlapQueryMeta = {

            rows:
                [...technicalRows],

            columns:
                [...technicalColumns],

            measures:
                technicalMeasures.map(
                    item => ({
                        field: item.field,
                        aggregation: item.aggregation
                    })
                ),

            hiddenTechnicalFields:
                [...hiddenTechnicalFields]
        };


        const body = {

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


            groupByRowFields:
                technicalRows,


            groupByColumnFields:
                technicalColumns,


            measures:
                technicalMeasures,


            filters:
                olapFilters.map(filter => ({
                    ...filter,
                    field: resolveTechnicalOlapFieldName(filter.field)
                })),

            from,

            to,

            buildSummary:
                true
        };


        console.log(
            "========================================"
        );


        console.log(
            "IIKO OLAP FRONTEND REQUEST:"
        );


        console.log(
            JSON.stringify(
                body,
                null,
                2
            )
        );


        console.log(
            "========================================"
        );


        const response =
            await fetch(
                "/api/iiko/olap",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            body
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

            const status =
                data.iikoHttpStatus ||
                response.status;


            const message =
                data.message ||
                data.rawResponse ||
                `iiko OLAP HTTP ${status}`;


            throw new Error(
                `iiko OLAP HTTP ${status}: ${message}`
            );
        }


        return data;
    }


    // ============================================================
    // RENDER OLAP RESULT
    // ============================================================

    function getOlapRowValue(
        row,
        technicalField
    ) {

        if (!row) {
            return undefined;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                row,
                technicalField
            )
        ) {
            return row[technicalField];
        }

        const wanted =
            String(
                technicalField || ""
            ).trim().toLowerCase();

        const key =
            Object.keys(row).find(
                item =>
                    String(
                        item || ""
                    ).trim().toLowerCase() ===
                    wanted
            );

        return key
            ? row[key]
            : undefined;
    }


    function normalizeOlapGroupValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .trim();
    }


    function getOlapGroupKey(
        row,
        fields
    ) {

        return fields
            .map(
                field =>
                    normalizeOlapGroupValue(
                        getOlapRowValue(
                            row,
                            field
                        )
                    )
            )
            .join("\u001f");
    }


    function parseOlapNumber(
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        if (
            typeof value ===
            "number"
        ) {
            return Number.isFinite(value)
                ? value
                : null;
        }

        let text =
            String(value)
                .trim();

        if (!text) {
            return null;
        }

        text = text
            .replace(/\s/g, "")
            .replace(/[^0-9,\.\-]/g, "");

        if (!text) {
            return null;
        }

        // 1.234,56 -> 1234.56
        if (
            text.includes(",") &&
            text.includes(".")
        ) {

            if (
                text.lastIndexOf(",") >
                text.lastIndexOf(".")
            ) {
                text = text
                    .replace(/\./g, "")
                    .replace(",", ".");
            }
            else {
                text = text
                    .replace(/,/g, "");
            }
        }
        else if (
            text.includes(",")
        ) {
            text = text.replace(",", ".");
        }

        const number =
            Number(text);

        return Number.isFinite(number)
            ? number
            : null;
    }


    function formatOlapNumber(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        if (
            Number.isInteger(value)
        ) {
            return String(value);
        }

        return Number(value)
            .toLocaleString(
                "ru-RU",
                {
                    maximumFractionDigits: 3
                }
            );
    }


    function aggregateOlapRows(
        rows,
        meta
    ) {

        if (
            !Array.isArray(rows) ||
            !rows.length
        ) {
            return {
                rows: [],
                groupTotals: [],
                grandTotals: {}
            };
        }

        const rowFields =
            meta?.rows || [];

        const columnFields =
            meta?.columns || [];

        const measures =
            meta?.measures || [];

        const hiddenFields =
            new Set(
                meta?.hiddenTechnicalFields || []
            );

        // --------------------------------------------------------
        // КЛЮЧ ГРУППИРОВКИ БЛЮДА
        //
        // iiko реально возвращает:
        //   DishName
        //   DishCode
        //
        // Нельзя группировать блюдо только по DishName.
        //
        // Если пользователь выбрал "Блюдо", обязательно добавляем
        // DishCode в ВНУТРЕННИЙ ключ группировки.
        //
        // Поэтому:
        //   cola / 00016 / 1
        //   cola / 00016 / 10
        //       -> одна строка, количество 11
        //
        // Но:
        //   SEZAR PIZZA / 00053 / 1
        //   SEZAR PIZZA / 00054 / 1
        //       -> две разные строки.
        //
        // DishCode НЕ выводится в таблицу.
        // --------------------------------------------------------

        const groupingFields = [
            ...rowFields,
            ...columnFields
        ];

        const hasDishNameGrouping =
            groupingFields.includes(
                "DishName"
            );

        const hasDishCodeGrouping =
            groupingFields.includes(
                "DishCode"
            );

        const hasDishCodeInData =
            rows.some(
                row =>
                    getOlapRowValue(
                        row,
                        "DishCode"
                    ) !== undefined
            );

        if (
            hasDishNameGrouping &&
            !hasDishCodeGrouping &&
            hasDishCodeInData
        ) {
            groupingFields.push(
                "DishCode"
            );
        }

        const groups =
            new Map();

        rows.forEach(
            row => {

                const key =
                    getOlapGroupKey(
                        row,
                        groupingFields
                    );

                let group =
                    groups.get(key);

                if (!group) {

                    group = {

                        firstRow:
                            { ...row },

                        rows: 0,

                        sums: {},

                        values: {}
                    };

                    measures.forEach(
                        measure => {

                            group.sums[
                                measure.field
                            ] = 0;

                            group.values[
                                measure.field
                            ] = [];
                        }
                    );

                    groups.set(
                        key,
                        group
                    );
                }

                group.rows += 1;

                measures.forEach(
                    measure => {

                        const value =
                            getOlapRowValue(
                                row,
                                measure.field
                            );

                        const number =
                            parseOlapNumber(
                                value
                            );

                        if (
                            number !== null
                        ) {

                            group.sums[
                                measure.field
                            ] += number;

                            group.values[
                                measure.field
                            ].push(number);
                        }
                    }
                );
            }
        );

        const aggregatedRows = [];

        groups.forEach(
            group => {

                const row = {
                    ...group.firstRow
                };

                measures.forEach(
                    measure => {

                        const values =
                            group.values[
                                measure.field
                            ] || [];

                        let result =
                            group.sums[
                                measure.field
                            ] || 0;

                        const aggregation =
                            String(
                                measure.aggregation ||
                                "SUM"
                            ).toUpperCase();

                        if (
                            aggregation ===
                            "AVG"
                        ) {

                            result =
                                values.length
                                    ? values.reduce(
                                        (
                                            sum,
                                            value
                                        ) =>
                                            sum + value,
                                        0
                                    ) /
                                      values.length
                                    : 0;
                        }
                        else if (
                            aggregation ===
                            "MIN"
                        ) {

                            result =
                                values.length
                                    ? Math.min(
                                        ...values
                                    )
                                    : 0;
                        }
                        else if (
                            aggregation ===
                            "MAX"
                        ) {

                            result =
                                values.length
                                    ? Math.max(
                                        ...values
                                    )
                                    : 0;
                        }
                        else {
                            // SUM и COUNT.
                            // Для COUNT iiko уже возвращает число
                            // в строке, поэтому при объединении
                            // строк их тоже складываем.
                            result =
                                group.sums[
                                    measure.field
                                ] || 0;
                        }

                        row[
                            measure.field
                        ] = result;
                    }
                );

                // Скрытые поля не нужны в визуальном результате,
                // но оставляем их внутри row для группировки.
                hiddenFields.forEach(
                    field => {
                        if (
                            !groupingFields.includes(
                                field
                            )
                        ) {
                            delete row[field];
                        }
                    }
                );

                aggregatedRows.push(
                    row
                );
            }
        );

        const grandTotals = {};

        measures.forEach(
            measure => {
                grandTotals[
                    measure.field
                ] = 0;
            }
        );

        aggregatedRows.forEach(
            row => {

                measures.forEach(
                    measure => {

                        const number =
                            parseOlapNumber(
                                getOlapRowValue(
                                    row,
                                    measure.field
                                )
                            );

                        if (
                            number !== null
                        ) {
                            grandTotals[
                                measure.field
                            ] += number;
                        }
                    }
                );
            }
        );

        // Суммы по верхнему уровню Строк.
        // Например, если Строки = Касса, получаем
        // "Demo kassa всего".
        const groupTotalsMap =
            new Map();

        if (rowFields.length) {

            aggregatedRows.forEach(
                row => {

                    const key =
                        getOlapGroupKey(
                            row,
                            rowFields
                        );

                    let total =
                        groupTotalsMap.get(
                            key
                        );

                    if (!total) {

                        total = {};

                        measures.forEach(
                            measure => {
                                total[
                                    measure.field
                                ] = 0;
                            }
                        );

                        groupTotalsMap.set(
                            key,
                            total
                        );
                    }

                    measures.forEach(
                        measure => {

                            const number =
                                parseOlapNumber(
                                    getOlapRowValue(
                                        row,
                                        measure.field
                                    )
                                );

                            if (
                                number !== null
                            ) {
                                total[
                                    measure.field
                                ] += number;
                            }
                        }
                    );
                }
            );
        }

        const groupTotals = [];

        groupTotalsMap.forEach(
            (totals, key) => {

                const sample =
                    aggregatedRows.find(
                        row =>
                            getOlapGroupKey(
                                row,
                                rowFields
                            ) === key
                    );

                groupTotals.push({

                    key,

                    values:
                        rowFields.map(
                            field =>
                                getOlapRowValue(
                                    sample,
                                    field
                                )
                        ),

                    totals
                });
            }
        );

        return {

            rows:
                aggregatedRows,

            groupTotals,

            grandTotals
        };
    }


    function renderOlapResult(
        data
    ) {

        const container =
            getElement(
                "olap-result"
            );

        if (!container) {
            return;
        }

        const report =
            data.report || {};

        const rawRows =
            Array.isArray(
                report.data
            )
                ? report.data
                : [];

        if (!rawRows.length) {

            container.innerHTML = `

                <div class="olap-empty">
                    OLAP не вернул строки
                </div>

            `;

            return;
        }

        const meta =
            lastOlapQueryMeta || {
                rows: [],
                columns: [],
                measures: [],
                hiddenTechnicalFields: []
            };

        const aggregated =
            aggregateOlapRows(
                rawRows,
                meta
            );

        console.log(
            "OLAP GROUP RESULT:",
            {
                rawRows: rawRows.length,
                aggregatedRows: aggregated.rows.length,
                groupingRows: meta.rows,
                groupingColumns: meta.columns,
                hiddenTechnicalFields:
                    meta.hiddenTechnicalFields || []
            }
        );

        const visibleColumns = [];

        [
            ...(meta.rows || []),
            ...(meta.columns || []),
            ...(meta.measures || []).map(
                item => item.field
            )
        ].forEach(
            field => {

                if (
                    !field ||
                    visibleColumns.includes(
                        field
                    )
                ) {
                    return;
                }

                if (
                    (meta.hiddenTechnicalFields || [])
                        .includes(field)
                ) {
                    return;
                }

                visibleColumns.push(
                    field
                );
            }
        );

        // Если по какой-либо причине метаданные запроса
        // отсутствуют, показываем поля самого ответа.
        if (!visibleColumns.length) {

            Object.keys(
                rawRows[0] || {}
            ).forEach(
                field => {

                    if (
                        !(meta.hiddenTechnicalFields || [])
                            .includes(field)
                    ) {
                        visibleColumns.push(
                            field
                        );
                    }
                }
            );
        }

        const rowFields =
            meta.rows || [];

        const hiddenTechnicalFieldSet =
            new Set(
                meta.hiddenTechnicalFields || []
            );

        // Для визуальной группировки используем только реальные
        // видимые поля "Строки". Скрытый DishCode нужен только
        // внутри aggregateOlapRows() для объединения одинаковых
        // блюд по коду.
        const visibleRowFields =
            rowFields.filter(
                field =>
                    !hiddenTechnicalFieldSet.has(
                        field
                    )
            );

        const measures =
            meta.measures || [];

        const groupFieldSet =
            new Set(
                visibleRowFields
            );

        const columnFields =
            meta.columns || [];

        const columnFieldSet =
            new Set(
                columnFields
            );

        const formatCell =
            value => {

                if (
                    value === null ||
                    value === undefined
                ) {
                    return "";
                }

                return escapeHtml(
                    value
                );
            };

        let html = `

            <div class="report-header">

                <h2>
                    📊 OLAP результат
                </h2>

            </div>

            <div class="report-table-wrapper">

                <table class="report-table olap-iiko-table">

                    <thead>

                        <tr>
        `;

        visibleColumns.forEach(
            column => {

                const field =
                    findOlapField(
                        column
                    );

                const title =
                    field
                        ? field.title
                        : column;

                html += `

                    <th>
                        ${escapeHtml(
                            title
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

        // --------------------------------------------------------
        // Строки группируем по полям из "Строки".
        // Например: Касса -> Demo kassa.
        // --------------------------------------------------------

        const groups = [];
        const groupMap = new Map();

        aggregated.rows.forEach(
            row => {

                const key =
                    visibleRowFields.length
                        ? getOlapGroupKey(
                            row,
                            visibleRowFields
                        )
                        : "__all__";

                let group =
                    groupMap.get(key);

                if (!group) {

                    group = {
                        key,
                        rows: []
                    };

                    groupMap.set(
                        key,
                        group
                    );

                    groups.push(
                        group
                    );
                }

                group.rows.push(
                    row
                );
            }
        );

        const collapsedGroups =
            new Set();

        groups.forEach(
            (group, groupIndex) => {

                if (visibleRowFields.length) {

                    const groupLabel =
                        visibleRowFields
                            .map(
                                field =>
                                    getOlapRowValue(
                                        group.rows[0],
                                        field
                                    )
                            )
                            .filter(
                                value =>
                                    value !== null &&
                                    value !== undefined &&
                                    String(value).trim() !== ""
                            )
                            .join(" / ") ||
                        "Без значения";

                    const groupLabelField =
                        visibleRowFields[0];

                    html += `

                        <tr
                            class="olap-group-row"
                            data-olap-group-index="${groupIndex}"
                        >
                    `;

                    visibleColumns.forEach(
                        column => {

                            if (
                                column ===
                                groupLabelField
                            ) {

                                html += `

                                    <td>

                                        <button
                                            type="button"
                                            class="olap-group-toggle"
                                            data-olap-group-toggle="${groupIndex}"
                                            aria-expanded="true"
                                        >
                                            ▼
                                        </button>

                                        <strong>
                                            ${escapeHtml(
                                                groupLabel
                                            )}
                                        </strong>

                                    </td>

                                `;

                            } else {

                                html += `
                                    <td></td>
                                `;
                            }
                        }
                    );

                    html += `

                        </tr>

                    `;
                }

                group.rows.forEach(
                    row => {

                        html += `

                            <tr
                                class="olap-data-row"
                                data-olap-group="${groupIndex}"
                            >
                        `;

                        visibleColumns.forEach(
                            column => {

                                let value =
                                    getOlapRowValue(
                                        row,
                                        column
                                    );

                                // Поля из "Строки" показываем пустыми
                                // внутри группы — их значение уже есть
                                // в заголовке группы.
                                if (
                                    groupFieldSet.has(
                                        column
                                    )
                                ) {
                                    value = "";
                                }

                                // Для показателей после нашей агрегации
                                // показываем итоговое число.
                                const measure =
                                    measures.find(
                                        item =>
                                            item.field ===
                                            column
                                    );

                                if (
                                    measure
                                ) {

                                    const number =
                                        parseOlapNumber(
                                            value
                                        );

                                    if (
                                        number !== null
                                    ) {
                                        value =
                                            formatOlapNumber(
                                                number
                                            );
                                    }
                                }

                                html += `

                                    <td>
                                        ${formatCell(
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

                // ------------------------------------------------
                // ИТОГО ПО ГРУППЕ
                // ------------------------------------------------

                if (visibleRowFields.length) {

                    const groupTotal =
                        aggregated.groupTotals.find(
                            item =>
                                item.key ===
                                getOlapGroupKey(
                                    group.rows[0],
                                    visibleRowFields
                                )
                        );

                    html += `

                        <tr
                            class="olap-group-total-row"
                            data-olap-group-total="${groupIndex}"
                        >
                    `;

                    visibleColumns.forEach(
                        column => {

                            const measure =
                                measures.find(
                                    item =>
                                        item.field ===
                                        column
                                );

                            if (
                                column ===
                                visibleRowFields[0]
                            ) {

                                html += `

                                    <td>
                                        <strong>
                                            ${escapeHtml(
                                                rowFields
                                                    .map(
                                                        field =>
                                                            getOlapRowValue(
                                                                group.rows[0],
                                                                field
                                                            )
                                                    )
                                                    .filter(
                                                        value =>
                                                            value !== null &&
                                                            value !== undefined &&
                                                            String(value).trim() !== ""
                                                    )
                                                    .join(" ")
                                            )} всего
                                        </strong>
                                    </td>

                                `;

                                return;
                            }

                            if (
                                measure &&
                                groupTotal
                            ) {

                                html += `

                                    <td>
                                        <strong>
                                            ${formatOlapNumber(
                                                groupTotal.totals[
                                                    measure.field
                                                ] || 0
                                            )}
                                        </strong>
                                    </td>

                                `;

                                return;
                            }

                            html += `

                                <td></td>

                            `;
                        }
                    );

                    html += `

                        </tr>

                    `;
                }
            }
        );

        // --------------------------------------------------------
        // ОБЩИЙ ИТОГ
        // --------------------------------------------------------

        if (
            measures.length
        ) {

            html += `

                <tr class="olap-grand-total-row">
            `;

            visibleColumns.forEach(
                (column, index) => {

                    const measure =
                        measures.find(
                            item =>
                                item.field ===
                                column
                        );

                    if (
                        index === 0
                    ) {

                        html += `

                            <td>
                                <strong>
                                    ИТОГО
                                </strong>
                            </td>

                        `;

                        return;
                    }

                    if (
                        measure
                    ) {

                        html += `

                            <td>
                                <strong>
                                    ${formatOlapNumber(
                                        aggregated.grandTotals[
                                            measure.field
                                        ] || 0
                                    )}
                                </strong>
                            </td>

                        `;

                        return;
                    }

                    html += `

                        <td></td>

                    `;
                }
            );

            html += `

                </tr>

            `;
        }

        html += `

                    </tbody>

                </table>

            </div>

        `;

        container.innerHTML =
            html;

        // --------------------------------------------------------
        // СВОРАЧИВАНИЕ ГРУПП
        // --------------------------------------------------------

        container
            .querySelectorAll(
                "[data-olap-group-toggle]"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        () => {

                            const index =
                                button.dataset
                                    .olapGroupToggle;

                            const isExpanded =
                                button.getAttribute(
                                    "aria-expanded"
                                ) === "true";

                            button.setAttribute(
                                "aria-expanded",
                                isExpanded
                                    ? "false"
                                    : "true"
                            );

                            button.textContent =
                                isExpanded
                                    ? "▶"
                                    : "▼";

                            container
                                .querySelectorAll(
                                    `[data-olap-group="${index}"], [data-olap-group-total="${index}"]`
                                )
                                .forEach(
                                    row => {
                                        row.style.display =
                                            isExpanded
                                                ? "none"
                                                : "";
                                    }
                                );
                        }
                    );
                }
            );
    }


    function ensureOlapResultStyles() {

        if (
            document.getElementById(
                "anar-olap-result-styles"
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "anar-olap-result-styles";

        style.textContent = `

            .olap-iiko-table {
                width: 100%;
                border-collapse: collapse;
            }

            .olap-iiko-table th,
            .olap-iiko-table td {
                padding: 10px 14px;
                border-bottom: 1px solid #e1e5ea;
                text-align: left;
            }

            .olap-iiko-table th {
                background: #f1f3f5;
                font-weight: 700;
            }

            .olap-iiko-table td:nth-last-child(-n+5) {
                text-align: right;
            }

            .olap-group-row td {
                background: #f3f4f6;
                padding: 10px 14px;
            }

            .olap-group-toggle {
                border: 0;
                background: transparent;
                padding: 0 10px 0 0;
                font-size: 15px;
                cursor: pointer;
            }

            .olap-group-total-row td {
                background: #fafafa;
                font-weight: 700;
                border-bottom: 2px solid #cfd5dc;
            }

            .olap-grand-total-row td {
                background: #e9edf2;
                font-weight: 800;
                border-top: 2px solid #aeb7c3;
            }

        `;

        document.head.appendChild(
            style
        );
    }


    // ============================================================
    // BIND OLAP EVENTS
    // ============================================================

    function bindOlapEvents() {

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


        const refresh =
            getElement(
                "olap-refresh-fields"
            );


        if (refresh) {

            refresh.addEventListener(
                "click",
                async function () {

                    this.disabled =
                        true;


                    setOlapStatus(
                        "⏳ Загружаем структуру OLAP..."
                    );


                    try {

                        await loadOlapFields();

                        renderOlapFields();
                        renderOlapFilterEditor();

                        setOlapStatus(
                            `🟢 Доступные поля OLAP: ${olapFields.length}`
                        );

                    } catch (error) {

                        console.error(
                            "OLAP FIELDS ERROR:",
                            error
                        );


                        // fallback
                        olapFields =
                            STANDARD_IIKO_FIELDS.map(
                                normalizeOlapField
                            );


                        renderOlapFields();


                        setOlapStatus(
                            `⚠️ Не удалось получить структуру OLAP. Используются стандартные поля iiko: ${olapFields.length}`
                        );

                    } finally {

                        this.disabled =
                            false;
                    }
                }
            );
        }


        const clear =
            getElement(
                "olap-clear"
            );


        if (clear) {

            clear.addEventListener(
                "click",
                clearOlap
            );
        }


        const run =
            getElement(
                "olap-run"
            );


        if (run) {

            run.addEventListener(
                "click",
                async function () {

                    this.disabled =
                        true;


                    this.textContent =
                        "Выполнение...";


                    const result =
                        getElement(
                            "olap-result"
                        );


                    if (result) {

                        result.innerHTML = `

                            <div class="report-loading">
                                ⏳ Выполняем OLAP запрос...
                            </div>

                        `;
                    }


                    try {

                        const data =
                            await runOlap();


                        renderOlapResult(
                            data
                        );

                    } catch (error) {

                        console.error(
                            "OLAP ERROR:",
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

                        this.disabled =
                            false;

                        this.textContent =
                            "Выполнить OLAP отчёт";
                    }
                }
            );
        }


        const filterOperator = getElement("olap-filter-operator");

        if (filterOperator) {
            filterOperator.addEventListener("change", updateOlapFilterInputMode);
        }

        const addFilterButton = getElement("olap-add-filter");

        if (addFilterButton) {
            addFilterButton.addEventListener("click", function () {
                try {
                    addOlapFilter();
                } catch (error) {
                    const result = getElement("olap-result");
                    if (result) {
                        result.innerHTML = `<div class="report-error">🔴 ${escapeHtml(error.message)}</div>`;
                    }
                }
            });
        }

        // --------------------------------------------------------
        // По умолчанию даты
        // --------------------------------------------------------

        const from =
            getElement(
                "olap-from"
            );

        const to =
            getElement(
                "olap-to"
            );


        if (from && !from.value) {

            from.value =
                todayString();
        }


        if (to && !to.value) {

            to.value =
                todayString();
        }


        renderOlapFields();
        renderOlapFilterEditor();
        bindOlapDropZones();
        renderSelectedOlapFields();
    }


    // ============================================================
    // CONNECT IIKO
    // ============================================================

    async function connectIiko() {

        const ipElement =
            getElement(
                "iiko-ip"
            );

        const portElement =
            getElement(
                "iiko-port"
            );

        const loginElement =
            getElement(
                "iiko-login"
            );

        const passwordElement =
            getElement(
                "iiko-password"
            );


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

            setIikoStatus(
                "⚠️ Заполните IP, порт, логин и пароль"
            );

            return;
        }


        if (connectButton) {

            connectButton.disabled =
                true;

            connectButton.textContent =
                "Подключение...";
        }


        setIikoStatus(
            "⏳ Подключаемся к iiko..."
        );


        try {

            const response =
                await fetch(
                    "/api/iiko/olap",
                    {

                        method:
                            "POST",

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
                "IIKO CONNECTION RESPONSE:",
                data
            );


            if (
                !response.ok ||
                data.success === false
            ) {

                throw new Error(

                    data.message ||

                    `Ошибка подключения HTTP ${response.status}`
                );
            }


            iikoConnection = {

                ip,

                port,

                login,

                password
            };


            if (
                rememberIiko &&
                rememberIiko.checked
            ) {

                localStorage.setItem(

                    IIKO_STORAGE_KEY,

                    JSON.stringify(
                        iikoConnection
                    )
                );
            }


            // ----------------------------------------------------
            // OLAP fields
            // ----------------------------------------------------

            const extracted =
                extractOlapFields(
                    data
                );


            if (extracted.length) {

                olapFields =
                    extracted;

            } else {

                olapFields =
                    STANDARD_IIKO_FIELDS.map(
                        normalizeOlapField
                    );
            }


            setIikoStatus(
                `🟢 Подключено к iiko. OLAP полей: ${olapFields.length}`
            );


            if (salesCard) {

                salesCard.style.display =
                    "block";
            }


            createOlapBuilder();

            renderOlapFields();

            renderSelectedOlapFields();


            setOlapStatus(
                `🟢 Доступные поля OLAP: ${olapFields.length}`
            );


        } catch (error) {

            console.error(
                "IIKO CONNECTION ERROR:",
                error
            );


            setIikoStatus(
                `🔴 ${error.message}`
            );


            iikoConnection =
                null;


        } finally {

            if (connectButton) {

                connectButton.disabled =
                    false;

                connectButton.textContent =
                    "Подключиться";
            }
        }
    }


    // ============================================================
    // SALES REPORT
    // ============================================================

    function setupSales() {

        if (!loadSalesButton) {
            return;
        }


        loadSalesButton.addEventListener(
            "click",
            async function () {

                if (!iikoConnection) {

                    if (salesResult) {

                        salesResult.innerHTML = `

                            <div class="report-error">
                                ⚠️ Сначала подключитесь к iiko
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

                                method:
                                    "POST",

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
    // INIT
    // ============================================================

    function init() {

        loadSavedIikoData();

        setupSales();


        if (connectButton) {

            connectButton.addEventListener(
                "click",
                connectIiko
            );
        }


        if (clearIikoData) {

            clearIikoData.addEventListener(
                "click",
                clearSavedIikoData
            );
        }


        // --------------------------------------------------------
        // Конструктор создаём сразу.
        // --------------------------------------------------------

        ensureOlapResultStyles();

        createOlapBuilder();


        // --------------------------------------------------------
        // Если сохранённые данные есть, НЕ подключаемся
        // автоматически — пользователь сам нажимает кнопку.
        // --------------------------------------------------------

        const from =
            getElement(
                "report-from"
            );

        const to =
            getElement(
                "report-to"
            );


        if (from && !from.value) {
            from.value =
                todayString();
        }


        if (to && !to.value) {
            to.value =
                todayString();
        }
    }


    // ============================================================
    // START
    // ============================================================

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();
    }

})();
