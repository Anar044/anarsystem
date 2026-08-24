(function () {
    "use strict";

    // ============================================================
    // IIKO REPORTS / OLAP CONSTRUCTOR
    // ============================================================

    const $ = id => document.getElementById(id);

    const STORAGE_KEY = "iikoConnection";

    let iikoConnection = null;

    let olapFields = [];
    let olapRows = [];
    let olapColumns = [];
    let olapMeasures = [];
    let olapFilters = [];

    let currentDrag = null;


    // ============================================================
    // HELPERS
    // ============================================================

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));
    }


    function today() {
        const d = new Date();

        return (
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0")
        );
    }


    async function safeJson(response) {

        const text = await response.text();

        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        }

        catch {
            return {
                success: false,
                message: text || `HTTP ${response.status}`
            };
        }
    }


    function setIikoStatus(text) {

        const element = $("iiko-status");

        if (element) {
            element.textContent = text;
        }
    }


    function setOlapStatus(text) {

        const element = $("olap-status");

        if (element) {
            element.textContent = text;
        }
    }


    // ============================================================
    // FIELD NORMALIZATION
    //
    // IMPORTANT:
    // iiko may return:
    //
    // title = "Сумма со скидкой"
    // technicalName = "DishDiscountSumInt"
    //
    // We MUST keep both.
    // ============================================================

    function normalizeField(field) {

        if (typeof field === "string") {

            const value = field.trim();

            if (!value) {
                return null;
            }

            return {
                name: value,
                technicalName: value,
                title: value,
                caption: value,
                type: "",
                isMeasure: false,
                aggregationAllowed: false,
                groupingAllowed: true,
                filteringAllowed: true
            };
        }


        if (!field || typeof field !== "object") {
            return null;
        }


        // --------------------------------------------------------
        // TECHNICAL NAME
        // --------------------------------------------------------

        const technicalName = String(
            field.technicalName ??
            field.technical_name ??
            field.TechnicalName ??
            field.fieldName ??
            field.field_name ??
            field.field ??
            field.key ??
            field.code ??
            field.id ??
            field.name ??
            ""
        ).trim();


        if (!technicalName) {
            return null;
        }


        // --------------------------------------------------------
        // DISPLAY TITLE
        // --------------------------------------------------------

        const title = String(
            field.title ??
            field.caption ??
            field.label ??
            field.displayName ??
            field.display_name ??
            field.description ??
            field.name ??
            technicalName
        ).trim();


        // --------------------------------------------------------
        // TYPE
        // --------------------------------------------------------

        const type = String(
            field.type ??
            field.dataType ??
            field.data_type ??
            field.kind ??
            ""
        ).trim();


        // --------------------------------------------------------
        // AGGREGATION
        // --------------------------------------------------------

        const aggregationAllowed =
            field.aggregationAllowed === true ||
            field.allowAggregation === true ||
            field.canAggregate === true ||
            field.isMeasure === true ||
            field.measure === true;


        const isMeasure =
            field.isMeasure === true ||
            field.measure === true ||
            aggregationAllowed;


        return {

            ...field,

            // technical name used in iiko request
            name: technicalName,

            technicalName,

            // human-readable name
            title,

            caption: title,

            type,

            isMeasure,

            aggregationAllowed,

            groupingAllowed:
                field.groupingAllowed !== false,

            filteringAllowed:
                field.filteringAllowed !== false
        };
    }


    // ============================================================
    // EXTRACT FIELDS
    // ============================================================

    function extractOlapFields(data) {

        const result = [];

        const seen = new Set();


        function add(value) {

            const field =
                normalizeField(value);


            if (!field) {
                return;
            }


            const technical =
                String(
                    field.technicalName ||
                    field.name
                ).trim();


            if (!technical) {
                return;
            }


            const key =
                technical.toLowerCase();


            if (seen.has(key)) {
                return;
            }


            seen.add(key);

            result.push(field);
        }


        function walk(value, depth = 0) {

            if (!value || depth > 7) {
                return;
            }


            if (Array.isArray(value)) {

                value.forEach(item => {

                    const field =
                        normalizeField(item);


                    if (field) {
                        add(item);
                    }

                    else {
                        walk(
                            item,
                            depth + 1
                        );
                    }

                });

                return;
            }


            if (
                typeof value !== "object"
            ) {
                return;
            }


            // ----------------------------------------------------
            // Common containers
            // ----------------------------------------------------

            const containers = [
                "fields",
                "columns",
                "items",
                "dimensions",
                "measures",
                "fieldDefinitions",
                "fielddefinitions",
                "availableFields",
                "available_fields"
            ];


            for (const key of containers) {

                if (
                    value[key] === undefined ||
                    value[key] === null
                ) {
                    continue;
                }


                const child =
                    value[key];


                if (Array.isArray(child)) {

                    child.forEach(add);
                }

                else if (
                    typeof child === "object"
                ) {

                    Object.values(child)
                        .forEach(add);
                }
            }


            // ----------------------------------------------------
            // Walk nested objects
            // ----------------------------------------------------

            for (
                const [key, child]
                of Object.entries(value)
            ) {

                if (
                    containers.includes(key)
                ) {
                    continue;
                }


                const field =
                    normalizeField(child);


                if (field) {

                    add(child);

                    continue;
                }


                if (
                    child &&
                    typeof child === "object"
                ) {

                    walk(
                        child,
                        depth + 1
                    );
                }
            }
        }


        // First try known field containers

        if (data?.fields) {

            if (
                Array.isArray(data.fields)
            ) {

                data.fields.forEach(add);
            }

            else if (
                typeof data.fields === "object"
            ) {

                Object.values(data.fields)
                    .forEach(add);
            }
        }


        if (data?.raw) {
            walk(data.raw);
        }


        if (!result.length) {
            walk(data);
        }


        return result;
    }


    // ============================================================
    // FIND FIELD
    // ============================================================

    function findOlapField(value) {

        if (!value) {
            return null;
        }


        const search =
            String(
                typeof value === "object"
                    ? (
                        value.technicalName ||
                        value.name ||
                        value.field ||
                        value.key ||
                        value.title ||
                        ""
                    )
                    : value
            ).trim();


        if (!search) {
            return null;
        }


        // --------------------------------------------------------
        // 1. Technical name exact
        // --------------------------------------------------------

        let field =
            olapFields.find(
                item =>
                    String(
                        item.technicalName ||
                        item.name ||
                        ""
                    ) === search
            );


        if (field) {
            return field;
        }


        // --------------------------------------------------------
        // 2. Technical name case insensitive
        // --------------------------------------------------------

        field =
            olapFields.find(
                item =>
                    String(
                        item.technicalName ||
                        item.name ||
                        ""
                    ).toLowerCase() ===
                    search.toLowerCase()
            );


        if (field) {
            return field;
        }


        // --------------------------------------------------------
        // 3. Display title exact
        // --------------------------------------------------------

        field =
            olapFields.find(
                item =>
                    String(
                        item.title ||
                        item.caption ||
                        ""
                    ) === search
            );


        if (field) {
            return field;
        }


        // --------------------------------------------------------
        // 4. Display title case insensitive
        // --------------------------------------------------------

        field =
            olapFields.find(
                item =>
                    String(
                        item.title ||
                        item.caption ||
                        ""
                    ).toLowerCase() ===
                    search.toLowerCase()
            );


        return field || null;
    }


    // ============================================================
    // RESOLVE TECHNICAL NAME
    //
    // THIS IS THE IMPORTANT FIX.
    // ============================================================

    function resolveTechnicalField(value) {

        const field =
            findOlapField(value);


        if (field) {

            const technical =
                field.technicalName ||
                field.name ||
                field.field ||
                field.key ||
                field.code;


            if (technical) {
                return String(
                    technical
                ).trim();
            }
        }


        // If value itself is already technical
        return String(
            typeof value === "object"
                ? (
                    value.technicalName ||
                    value.name ||
                    value.field ||
                    value.key ||
                    ""
                )
                : value || ""
        ).trim();
    }


    // ============================================================
    // LOAD OLAP FIELDS
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
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            action: "fields",

                            reportType: "SALES",

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


        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(
                data.message ||
                `OLAP fields HTTP ${response.status}`
            );
        }


        olapFields =
            extractOlapFields(data);


        if (!olapFields.length) {

            throw new Error(
                "iiko не вернул список OLAP полей"
            );
        }


        renderOlapFields();

        renderFilterEditor();


        setOlapStatus(
            `🟢 Доступные поля OLAP: ${olapFields.length}`
        );


        console.log(
            "IIKO OLAP FIELDS:",
            olapFields
        );


        return olapFields;
    }


    // ============================================================
    // CREATE BUILDER
    // ============================================================

    function createOlapBuilder() {

        const existing =
            $("olap-builder");


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
                    Перетащите поле из списка слева
                    в Строки, Колонки или Показатели.
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


                <!-- FILTERS -->

                <div class="olap-filters-panel">

                    <h3>
                        Фильтры
                    </h3>


                    <div class="olap-filter-editor">

                        <label>

                            Поле

                            <select
                                id="olap-filter-field"
                            ></select>

                        </label>


                        <label>

                            Условие

                            <select
                                id="olap-filter-operator"
                            >

                                <option value="Include">
                                    Равно
                                </option>

                                <option value="Exclude">
                                    Не равно
                                </option>

                                <option value="IncludeList">
                                    В списке
                                </option>

                                <option value="ExcludeList">
                                    Не в списке
                                </option>

                                <option value="DateRange">
                                    Диапазон дат
                                </option>

                            </select>

                        </label>


                        <label
                            id="olap-filter-value-label"
                        >

                            Значение

                            <input
                                id="olap-filter-value"
                                type="text"
                            >

                        </label>


                        <label
                            id="olap-filter-from-label"
                            style="display:none"
                        >

                            От

                            <input
                                id="olap-filter-from"
                                type="date"
                            >

                        </label>


                        <label
                            id="olap-filter-to-label"
                            style="display:none"
                        >

                            До

                            <input
                                id="olap-filter-to"
                                type="date"
                            >

                        </label>


                        <button
                            type="button"
                            id="olap-add-filter"
                        >
                            + Добавить фильтр
                        </button>

                    </div>


                    <div
                        id="olap-filters"
                        class="olap-filters-list"
                    >

                        <div class="olap-empty">
                            Фильтры не заданы
                        </div>

                    </div>

                </div>


                <!-- PERIOD -->

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
    // RENDER AVAILABLE FIELDS
    // ============================================================

    function renderOlapFields() {

        const container =
            $("olap-fields");


        if (!container) {
            return;
        }


        const search =
            (
                $("olap-search")?.value ||
                ""
            )
                .trim()
                .toLowerCase();


        const filtered =
            olapFields.filter(
                field => {

                    if (!search) {
                        return true;
                    }


                    return (

                        String(
                            field.title ||
                            ""
                        )
                            .toLowerCase()
                            .includes(search)

                        ||

                        String(
                            field.technicalName ||
                            field.name ||
                            ""
                        )
                            .toLowerCase()
                            .includes(search)

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
            filtered
                .map(field => {

                    const flags = [];


                    if (
                        field.groupingAllowed !== false
                    ) {
                        flags.push("Г");
                    }


                    if (
                        field.aggregationAllowed ||
                        field.isMeasure
                    ) {
                        flags.push("Σ");
                    }


                    if (
                        field.filteringAllowed !== false
                    ) {
                        flags.push("Ф");
                    }


                    const technical =
                        field.technicalName ||
                        field.name;


                    return `

                        <button
                            type="button"
                            class="olap-field"
                            draggable="true"
                            data-field="${esc(technical)}"
                        >

                            <span>

                                <strong>
                                    ${esc(
                                        field.title ||
                                        technical
                                    )}
                                </strong>


                                <small>
                                    ${esc(technical)}
                                </small>

                            </span>


                            <span class="olap-flags">
                                ${esc(
                                    flags.join(" ")
                                )}
                            </span>

                        </button>

                    `;
                })
                .join("");


        container
            .querySelectorAll(
                ".olap-field"
            )
            .forEach(button => {

                button.addEventListener(
                    "dragstart",
                    event => {

                        currentDrag = {

                            source:
                                "available",

                            field:
                                button.dataset.field

                        };


                        event.dataTransfer
                            .effectAllowed =
                            "copy";


                        event.dataTransfer
                            .setData(
                                "text/plain",
                                button.dataset.field
                            );
                    }
                );

            });
    }


    // ============================================================
    // REMOVE FROM OTHER GROUPS
    // ============================================================

    function removeFromOtherGroups(
        fieldName,
        keep
    ) {

        const name =
            resolveTechnicalField(
                fieldName
            );


        if (keep !== "rows") {

            olapRows =
                olapRows.filter(
                    field =>
                        resolveTechnicalField(
                            field
                        ) !== name
                );
        }


        if (keep !== "columns") {

            olapColumns =
                olapColumns.filter(
                    field =>
                        resolveTechnicalField(
                            field
                        ) !== name
                );
        }


        if (keep !== "measures") {

            olapMeasures =
                olapMeasures.filter(
                    item =>
                        resolveTechnicalField(
                            item.field
                        ) !== name
                );
        }
    }


    // ============================================================
    // ADD FIELD
    // ============================================================

    function addOlapField(
        type,
        fieldName,
        aggregation = "SUM"
    ) {

        const name =
            resolveTechnicalField(
                fieldName
            );


        if (!name) {
            return;
        }


        const field =
            findOlapField(
                fieldName
            );


        if (
            type === "measures" &&
            field &&
            field.aggregationAllowed === false &&
            field.isMeasure !== true
        ) {

            setOlapStatus(
                "⚠️ Это поле нельзя использовать как показатель"
            );

            return;
        }


        removeFromOtherGroups(
            name,
            type
        );


        if (type === "rows") {

            if (
                !olapRows.some(
                    item =>
                        resolveTechnicalField(
                            item
                        ) === name
                )
            ) {

                olapRows.push(name);
            }
        }


        if (type === "columns") {

            if (
                !olapColumns.some(
                    item =>
                        resolveTechnicalField(
                            item
                        ) === name
                )
            ) {

                olapColumns.push(name);
            }
        }


        if (type === "measures") {

            if (
                !olapMeasures.some(
                    item =>
                        resolveTechnicalField(
                            item.field
                        ) === name
                )
            ) {

                olapMeasures.push({

                    field: name,

                    aggregation:
                        aggregation || "SUM"

                });
            }
        }


        renderSelectedFields();
    }


    // ============================================================
    // RENDER SELECTED FIELDS
    // ============================================================

    function renderSelectedFields() {

        renderSelectedGroup(
            "olap-rows",
            "rows",
            olapRows
        );


        renderSelectedGroup(
            "olap-columns",
            "columns",
            olapColumns
        );


        renderSelectedGroup(
            "olap-measures",
            "measures",
            olapMeasures
        );
    }


    function renderSelectedGroup(
        elementId,
        type,
        values
    ) {

        const container =
            $(elementId);


        if (!container) {
            return;
        }


        if (!values.length) {

            container.innerHTML = `

                <div class="olap-empty">
                    Перетащите поле сюда
                </div>

            `;

            bindOlapDropZones();

            return;
        }


        container.innerHTML =
            values
                .map(
                    (item, index) => {

                        const name =
                            type === "measures"
                                ? item.field
                                : item;


                        const field =
                            findOlapField(
                                name
                            );


                        return `

                            <div
                                class="olap-selected-field"
                                draggable="true"
                                data-type="${esc(type)}"
                                data-index="${index}"
                                data-field="${esc(name)}"
                            >

                                <span>

                                    <strong>
                                        ${esc(
                                            field?.title ||
                                            field?.caption ||
                                            name
                                        )}
                                    </strong>


                                    <small>

                                        ${esc(
                                            field?.technicalName ||
                                            name
                                        )}

                                        ${
                                            type ===
                                            "measures"
                                                ? ` • ${esc(
                                                    item.aggregation ||
                                                    "SUM"
                                                )}`
                                                : ""
                                        }

                                    </small>

                                </span>


                                <button
                                    type="button"
                                    data-remove="1"
                                >
                                    ×
                                </button>

                            </div>

                        `;
                    }
                )
                .join("");


        container
            .querySelectorAll(
                ".olap-selected-field"
            )
            .forEach(element => {

                element.addEventListener(
                    "dragstart",
                    event => {

                        currentDrag = {

                            source:
                                element.dataset.type,

                            index:
                                Number(
                                    element.dataset.index
                                ),

                            field:
                                element.dataset.field

                        };


                        event.dataTransfer
                            .effectAllowed =
                            "move";


                        event.dataTransfer
                            .setData(
                                "text/plain",
                                element.dataset.field
                            );
                    }
                );


                const removeButton =
                    element.querySelector(
                        "[data-remove]"
                    );


                if (removeButton) {

                    removeButton.onclick =
                        () => {

                            const index =
                                Number(
                                    element.dataset.index
                                );


                            if (
                                type === "rows"
                            ) {

                                olapRows.splice(
                                    index,
                                    1
                                );
                            }


                            if (
                                type === "columns"
                            ) {

                                olapColumns.splice(
                                    index,
                                    1
                                );
                            }


                            if (
                                type === "measures"
                            ) {

                                olapMeasures.splice(
                                    index,
                                    1
                                );
                            }


                            renderSelectedFields();
                        };
                }

            });


        bindOlapDropZones();
    }


    // ============================================================
    // DRAG & DROP
    // ============================================================

    function bindOlapDropZones() {

        const zones = [

            [
                "olap-rows",
                "rows"
            ],

            [
                "olap-columns",
                "columns"
            ],

            [
                "olap-measures",
                "measures"
            ]

        ];


        zones.forEach(
            ([elementId, targetType]) => {

                const zone =
                    $(elementId);


                if (!zone) {
                    return;
                }


                if (
                    zone.dataset.dropBound === "1"
                ) {
                    return;
                }


                zone.dataset.dropBound =
                    "1";


                zone.addEventListener(
                    "dragover",
                    event => {

                        if (
                            !currentDrag ||
                            !currentDrag.field
                        ) {
                            return;
                        }


                        const field =
                            findOlapField(
                                currentDrag.field
                            );


                        if (
                            targetType ===
                                "measures" &&

                            field &&

                            field.aggregationAllowed ===
                                false &&

                            field.isMeasure !==
                                true
                        ) {

                            return;
                        }


                        event.preventDefault();


                        event.dataTransfer
                            .dropEffect =
                            currentDrag.source ===
                            "available"
                                ? "copy"
                                : "move";


                        zone.classList.add(
                            "olap-drop-active"
                        );
                    }
                );


                zone.addEventListener(
                    "dragleave",
                    event => {

                        if (
                            !zone.contains(
                                event.relatedTarget
                            )
                        ) {

                            zone.classList.remove(
                                "olap-drop-active"
                            );
                        }
                    }
                );


                zone.addEventListener(
                    "drop",
                    event => {

                        event.preventDefault();


                        zone.classList.remove(
                            "olap-drop-active"
                        );


                        if (
                            !currentDrag ||
                            !currentDrag.field
                        ) {
                            return;
                        }


                        const field =
                            findOlapField(
                                currentDrag.field
                            );


                        if (
                            targetType ===
                                "measures" &&

                            field &&

                            field.aggregationAllowed ===
                                false &&

                            field.isMeasure !==
                                true
                        ) {

                            currentDrag =
                                null;

                            return;
                        }


                        addOlapField(
                            targetType,
                            currentDrag.field,
                            "SUM"
                        );


                        currentDrag =
                            null;
                    }
                );
            }
        );
    }


    // ============================================================
    // FILTER EDITOR
    // ============================================================

    function renderFilterEditor() {

        const select =
            $("olap-filter-field");


        if (!select) {
            return;
        }


        const available =
            olapFields.filter(
                field =>
                    field.filteringAllowed !== false
            );


        select.innerHTML =
            available
                .map(
                    field => {

                        const technical =
                            field.technicalName ||
                            field.name;


                        return `

                            <option
                                value="${esc(technical)}"
                            >
                                ${esc(
                                    field.title ||
                                    technical
                                )}
                            </option>

                        `;
                    }
                )
                .join("");


        updateFilterInputMode();
    }


    function updateFilterInputMode() {

        const operator =
            $("olap-filter-operator")
                ?.value;


        const isDate =
            operator === "DateRange";


        const valueLabel =
            $("olap-filter-value-label");


        const fromLabel =
            $("olap-filter-from-label");


        const toLabel =
            $("olap-filter-to-label");


        if (valueLabel) {

            valueLabel.style.display =
                isDate
                    ? "none"
                    : "block";
        }


        if (fromLabel) {

            fromLabel.style.display =
                isDate
                    ? "block"
                    : "none";
        }


        if (toLabel) {

            toLabel.style.display =
                isDate
                    ? "block"
                    : "none";
        }
    }


    // ============================================================
    // ADD FILTER
    // ============================================================

    function addOlapFilter() {

        const field =
            $("olap-filter-field")
                ?.value;


        const operator =
            $("olap-filter-operator")
                ?.value ||
            "Include";


        if (!field) {

            throw new Error(
                "Выберите поле для фильтра"
            );
        }


        if (
            operator ===
            "DateRange"
        ) {

            const from =
                $("olap-filter-from")
                    ?.value;


            const to =
                $("olap-filter-to")
                    ?.value;


            if (!from || !to) {

                throw new Error(
                    "Укажите обе даты фильтра"
                );
            }


            if (from > to) {

                throw new Error(
                    "Неверный диапазон дат"
                );
            }


            olapFilters.push({

                field:
                    resolveTechnicalField(
                        field
                    ),

                operator,

                from,

                to

            });
        }


        else {

            const value =
                (
                    $("olap-filter-value")
                        ?.value ||
                    ""
                ).trim();


            if (!value) {

                throw new Error(
                    "Укажите значение фильтра"
                );
            }


            if (
                operator ===
                    "IncludeList" ||

                operator ===
                    "ExcludeList"
            ) {

                const values =
                    value
                        .split(",")
                        .map(
                            item =>
                                item.trim()
                        )
                        .filter(Boolean);


                if (!values.length) {

                    throw new Error(
                        "Укажите значения"
                    );
                }


                olapFilters.push({

                    field:
                        resolveTechnicalField(
                            field
                        ),

                    operator,

                    values

                });
            }


            else {

                olapFilters.push({

                    field:
                        resolveTechnicalField(
                            field
                        ),

                    operator,

                    value

                });
            }
        }


        const input =
            $("olap-filter-value");


        if (input) {
            input.value = "";
        }


        renderOlapFilters();
    }


    // ============================================================
    // RENDER FILTERS
    // ============================================================

    function renderOlapFilters() {

        const container =
            $("olap-filters");


        if (!container) {
            return;
        }


        if (!olapFilters.length) {

            container.innerHTML = `

                <div class="olap-empty">
                    Фильтры не заданы
                </div>

            `;

            return;
        }


        container.innerHTML =
            olapFilters
                .map(
                    (filter, index) => {

                        const field =
                            findOlapField(
                                filter.field
                            );


                        let operator =
                            "Равно";


                        let value =
                            filter.value ||
                            "";


                        if (
                            filter.operator ===
                            "Exclude"
                        ) {

                            operator =
                                "Не равно";
                        }


                        if (
                            filter.operator ===
                            "IncludeList"
                        ) {

                            operator =
                                "В списке";


                            value =
                                (
                                    filter.values ||
                                    []
                                ).join(", ");
                        }


                        if (
                            filter.operator ===
                            "ExcludeList"
                        ) {

                            operator =
                                "Не в списке";


                            value =
                                (
                                    filter.values ||
                                    []
                                ).join(", ");
                        }


                        if (
                            filter.operator ===
                            "DateRange"
                        ) {

                            operator =
                                "Диапазон";


                            value =
                                `${filter.from} — ${filter.to}`;
                        }


                        return `

                            <div
                                class="olap-filter-item"
                            >

                                <div>

                                    <strong>
                                        ${esc(
                                            field?.title ||
                                            filter.field
                                        )}
                                    </strong>


                                    <small>
                                        ${esc(operator)}
                                        •
                                        ${esc(value)}
                                    </small>

                                </div>


                                <button
                                    type="button"
                                    data-filter-index="${index}"
                                >
                                    ×
                                </button>

                            </div>

                        `;
                    }
                )
                .join("");


        container
            .querySelectorAll(
                "[data-filter-index]"
            )
            .forEach(button => {

                button.onclick =
                    () => {

                        const index =
                            Number(
                                button.dataset
                                    .filterIndex
                            );


                        olapFilters.splice(
                            index,
                            1
                        );


                        renderOlapFilters();
                    };
            });
    }


    // ============================================================
    // CLEAR
    // ============================================================

    function clearOlap() {

        olapRows = [];

        olapColumns = [];

        olapMeasures = [];

        olapFilters = [];


        renderSelectedFields();

        renderOlapFilters();


        const result =
            $("olap-result");


        if (result) {
            result.innerHTML = "";
        }


        setOlapStatus(
            `🟢 Доступные поля OLAP: ${olapFields.length}`
        );
    }


    // ============================================================
    // BUILD REQUEST
    // ============================================================

    function buildOlapRequest() {

        const from =
            $("olap-from")
                ?.value ||
            "";


        const to =
            $("olap-to")
                ?.value ||
            "";


        if (
            !olapRows.length &&
            !olapColumns.length &&
            !olapMeasures.length
        ) {

            throw new Error(
                "Выберите хотя бы одно поле в Строки, Колонки или Показатели"
            );
        }


        if (
            from &&
            to &&
            from > to
        ) {

            throw new Error(
                "Неверный период"
            );
        }


        // --------------------------------------------------------
        // TECHNICAL NAMES
        // --------------------------------------------------------

        const rowFields =
            olapRows
                .map(
                    resolveTechnicalField
                )
                .filter(Boolean);


        const columnFields =
            olapColumns
                .map(
                    resolveTechnicalField
                )
                .filter(Boolean);


        const measures =
            olapMeasures
                .map(
                    item =>
                        resolveTechnicalField(
                            item.field
                        )
                )
                .filter(Boolean);


        const filters =
            olapFilters
                .map(
                    filter => {

                        const result = {
                            ...filter,

                            field:
                                resolveTechnicalField(
                                    filter.field
                                )
                        };


                        return result;
                    }
                )
                .filter(
                    filter =>
                        Boolean(
                            filter.field
                        )
                );


        const request = {

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
                rowFields,


            groupByColumnFields:
                columnFields,


            measures,


            filters,


            from,

            to,


            buildSummary:
                true
        };


        console.log(
            "================================"
        );

        console.log(
            "IIKO OLAP FINAL REQUEST"
        );

        console.log(
            JSON.stringify(
                request,
                null,
                2
            )
        );

        console.log(
            "================================"
        );


        return request;
    }


    // ============================================================
    // RUN OLAP
    // ============================================================

    async function runOlap() {

        const result =
            $("olap-result");


        try {

            if (!iikoConnection) {

                throw new Error(
                    "Сначала подключитесь к iiko"
                );
            }


            const request =
                buildOlapRequest();


            if (result) {

                result.innerHTML = `

                    <div class="report-loading">
                        ⏳ Получаем данные из iiko...
                    </div>

                `;
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
                            JSON.stringify(
                                request
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
                    data.rawResponse ||
                    `iiko OLAP HTTP ${response.status}`
                );
            }


            renderOlapResult(
                data
            );
        }


        catch (error) {

            console.error(
                "OLAP ERROR:",
                error
            );


            if (!result) {
                return;
            }


            let request = {};


            try {

                request =
                    buildOlapRequest();

            }

            catch {

                request = {

                    groupByRowFields:
                        olapRows,

                    groupByColumnFields:
                        olapColumns,

                    measures:
                        olapMeasures,

                    filters:
                        olapFilters
                };
            }


            result.innerHTML = `

                <div class="report-error">

                    🔴 ${esc(
                        error.message
                    )}

                </div>


                <pre>${esc(
                    JSON.stringify(
                        {
                            success:
                                false,

                            message:
                                error.message,

                            request

                        },
                        null,
                        2
                    )
                )}</pre>

            `;
        }
    }


    // ============================================================
    // RENDER OLAP RESULT
    // ============================================================

    function renderOlapResult(data) {

        const result =
            $("olap-result");


        if (!result) {
            return;
        }


        const report =
            data.report ||
            data;


        let raw =
            report.rawResponse ||
            report.response ||
            report.data ||
            data.data ||
            [];


        if (
            typeof raw === "string"
        ) {

            try {
                raw =
                    JSON.parse(raw);
            }

            catch {
                // leave as string
            }
        }


        let rowsData = [];


        if (
            Array.isArray(raw)
        ) {

            rowsData =
                raw;
        }


        else if (
            raw &&
            Array.isArray(
                raw.data
            )
        ) {

            rowsData =
                raw.data;
        }


        else if (
            raw &&
            Array.isArray(
                raw.rows
            )
        ) {

            rowsData =
                raw.rows;
        }


        if (!rowsData.length) {

            result.innerHTML = `

                <div class="report-header">

                    <strong>
                        Отчёт выполнен
                    </strong>

                </div>


                <div class="olap-empty">

                    iiko не вернул строки данных.

                </div>


                <pre>${esc(
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                )}</pre>

            `;

            return;
        }


        const keys = [
            ...new Set(
                rowsData.flatMap(
                    row =>
                        Object.keys(
                            row || {}
                        )
                )
            )
        ];


        result.innerHTML = `

            <div class="report-header">

                <strong>
                    Результат OLAP
                </strong>


                <span>
                    ${rowsData.length} строк
                </span>

            </div>


            <div
                class="report-table-wrapper"
            >

                <table
                    class="report-table"
                >

                    <thead>

                        <tr>

                            ${
                                keys
                                    .map(
                                        key => `
                                            <th>
                                                ${esc(key)}
                                            </th>
                                        `
                                    )
                                    .join("")
                            }

                        </tr>

                    </thead>


                    <tbody>

                        ${
                            rowsData
                                .map(
                                    row => `

                                        <tr>

                                            ${
                                                keys
                                                    .map(
                                                        key => `
                                                            <td>
                                                                ${esc(
                                                                    row?.[key]
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

            </div>

        `;
    }


    // ============================================================
    // CONNECT IIKO
    // ============================================================

    async function connectIiko() {

        const ip =
            $("iiko-ip")
                ?.value
                .trim();


        const port =
            $("iiko-port")
                ?.value
                .trim();


        const login =
            $("iiko-login")
                ?.value
                .trim();


        const password =
            $("iiko-password")
                ?.value;


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


        iikoConnection = {

            ip,

            port,

            login,

            password

        };


        setIikoStatus(
            "⏳ Подключение к iiko..."
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


            if (
                !response.ok ||
                data.success === false
            ) {

                throw new Error(
                    data.message ||
                    `HTTP ${response.status}`
                );
            }


            if (
                $("remember-iiko")
                    ?.checked
            ) {

                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(
                        iikoConnection
                    )
                );
            }


            if (
                $("sales-card")
            ) {

                $("sales-card")
                    .style
                    .display =
                    "block";
            }


            setIikoStatus(
                "🟢 iiko подключён"
            );


            createOlapBuilder();


            olapFields =
                extractOlapFields(
                    data
                );


            if (
                !olapFields.length
            ) {

                await loadOlapFields();
            }

            else {

                renderOlapFields();

                renderFilterEditor();


                setOlapStatus(
                    `🟢 Доступные поля OLAP: ${olapFields.length}`
                );
            }


            setDefaultPeriods();


            console.log(
                "NORMALIZED IIKO FIELDS:",
                olapFields
            );
        }


        catch (error) {

            console.error(
                "IIKO CONNECT ERROR:",
                error
            );


            iikoConnection =
                null;


            setIikoStatus(
                "🔴 " +
                error.message
            );
        }
    }


    // ============================================================
    // SAVED IIKO DATA
    // ============================================================

    function loadSavedIikoData() {

        try {

            const saved =
                localStorage.getItem(
                    STORAGE_KEY
                );


            if (!saved) {
                return;
            }


            const data =
                JSON.parse(
                    saved
                );


            [
                "ip",
                "port",
                "login",
                "password"
            ]
                .forEach(
                    key => {

                        const element =
                            $(
                                `iiko-${key}`
                            );


                        if (
                            element &&
                            data[key] != null
                        ) {

                            element.value =
                                data[key];
                        }
                    }
                );


            if (
                $("remember-iiko")
            ) {

                $("remember-iiko")
                    .checked =
                    true;
            }
        }


        catch (error) {

            console.warn(
                "Cannot load saved iiko data",
                error
            );
        }
    }


    function clearSavedIikoData() {

        localStorage.removeItem(
            STORAGE_KEY
        );


        [
            "ip",
            "port",
            "login",
            "password"
        ]
            .forEach(
                key => {

                    const element =
                        $(
                            `iiko-${key}`
                        );


                    if (element) {
                        element.value = "";
                    }
                }
            );


        if (
            $("remember-iiko")
        ) {

            $("remember-iiko")
                .checked =
                false;
        }


        iikoConnection =
            null;


        setIikoStatus(
            "⚪ Сохранённые данные очищены"
        );
    }


    // ============================================================
    // SALES REPORT
    // ============================================================

    async function loadSalesReport() {

        const result =
            $("sales-result");


        if (!iikoConnection) {

            if (result) {

                result.innerHTML = `

                    <div class="report-error">
                        ⚠️ Сначала подключитесь к iiko
                    </div>

                `;
            }

            return;
        }


        const from =
            $("report-from")
                ?.value;


        const to =
            $("report-to")
                ?.value;


        if (
            !from ||
            !to ||
            from > to
        ) {

            if (result) {

                result.innerHTML = `

                    <div class="report-error">
                        ⚠️ Выберите правильный период
                    </div>

                `;
            }

            return;
        }


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
                data
            );
        }


        catch (error) {

            if (result) {

                result.innerHTML = `

                    <div class="report-error">
                        🔴 ${esc(
                            error.message
                        )}
                    </div>

                `;
            }
        }
    }


    function renderSalesReport(data) {

        const result =
            $("sales-result");


        if (!result) {
            return;
        }


        const report =
            data.report ||
            data;


        let raw =
            report.rawResponse ||
            report.data ||
            data.data ||
            [];


        if (
            raw &&
            !Array.isArray(raw) &&
            Array.isArray(
                raw.data
            )
        ) {

            raw =
                raw.data;
        }


        if (!Array.isArray(raw)) {
            raw = [];
        }


        if (!raw.length) {

            result.innerHTML = `

                <pre>${esc(
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                )}</pre>

            `;

            return;
        }


        const keys = [

            ...new Set(
                raw.flatMap(
                    row =>
                        Object.keys(
                            row || {}
                        )
                )
            )

        ];


        result.innerHTML = `

            <div
                class="report-table-wrapper"
            >

                <table
                    class="report-table"
                >

                    <thead>

                        <tr>

                            ${
                                keys
                                    .map(
                                        key =>
                                            `<th>${esc(key)}</th>`
                                    )
                                    .join("")
                            }

                        </tr>

                    </thead>


                    <tbody>

                        ${
                            raw
                                .map(
                                    row => `

                                        <tr>

                                            ${
                                                keys
                                                    .map(
                                                        key =>
                                                            `<td>${esc(row?.[key])}</td>`
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

            </div>

        `;
    }


    // ============================================================
    // DEFAULT PERIOD
    // ============================================================

    function setDefaultPeriods() {

        const ids = [

            "report-from",
            "report-to",
            "olap-from",
            "olap-to"

        ];


        ids.forEach(
            id => {

                const element =
                    $(id);


                if (
                    element &&
                    !element.value
                ) {

                    element.value =
                        today();
                }
            }
        );
    }


    // ============================================================
    // EVENTS
    // ============================================================

    function bindOlapEvents() {

        const search =
            $("olap-search");


        if (search) {

            search.addEventListener(
                "input",
                renderOlapFields
            );
        }


        const refresh =
            $("olap-refresh-fields");


        if (refresh) {

            refresh.onclick =
                async () => {

                    try {

                        setOlapStatus(
                            "⏳ Загружаем поля..."
                        );


                        await loadOlapFields();
                    }


                    catch (error) {

                        setOlapStatus(
                            "🔴 " +
                            error.message
                        );
                    }
                };
        }


        const clear =
            $("olap-clear");


        if (clear) {

            clear.onclick =
                clearOlap;
        }


        const operator =
            $("olap-filter-operator");


        if (operator) {

            operator.onchange =
                updateFilterInputMode;
        }


        const addFilter =
            $("olap-add-filter");


        if (addFilter) {

            addFilter.onclick =
                () => {

                    try {

                        addOlapFilter();
                    }


                    catch (error) {

                        setOlapStatus(
                            "🔴 " +
                            error.message
                        );
                    }
                };
        }


        const run =
            $("olap-run");


        if (run) {

            run.onclick =
                runOlap;
        }


        bindOlapDropZones();
    }


    // ============================================================
    // INIT
    // ============================================================

    function init() {

        createOlapBuilder();

        loadSavedIikoData();

        setDefaultPeriods();


        const connect =
            $("connect-iiko");


        if (connect) {

            connect.onclick =
                connectIiko;
        }


        const clear =
            $("clear-iiko-data");


        if (clear) {

            clear.onclick =
                clearSavedIikoData;
        }


        const sales =
            $("load-sales");


        if (sales) {

            sales.onclick =
                loadSalesReport;
        }
    }


    document.addEventListener(
        "DOMContentLoaded",
        init
    );

})();
