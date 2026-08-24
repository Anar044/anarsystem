(function () {
    "use strict";

    const $ = id => document.getElementById(id);

    const esc = value =>
        String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));

    const today = () => {
        const d = new Date();

        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    let iikoConnection = null;

    let olapFields = [];
    let olapRows = [];
    let olapColumns = [];
    let olapMeasures = [];
    let olapFilters = [];

    let currentDrag = null;

    const STORAGE_KEY = "iikoConnection";


    // ============================================================
    // JSON
    // ============================================================

    async function safeJson(response) {

        const text = await response.text();

        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            return {
                success: false,
                message: text || `HTTP ${response.status}`
            };
        }
    }


    // ============================================================
    // STATUS
    // ============================================================

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
    // OLAP FIELD NORMALIZATION
    // ============================================================

    function normalizeField(field) {

        if (typeof field === "string") {

            const name = field.trim();

            if (!name) {
                return null;
            }

            return {
                name,
                title: name,
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


        const name = String(
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


        return {
            ...field,

            name,

            title: String(
                field.title ||
                field.caption ||
                field.label ||
                field.displayName ||
                name
            ),

            type: String(
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
    // EXTRACT FIELDS FROM IIKO RESPONSE
    // ============================================================

    function extractOlapFields(data) {

        const result = [];
        const seen = new Set();


        function add(value) {

            const field = normalizeField(value);

            if (!field) {
                return;
            }

            const key = field.name.toLowerCase();

            if (seen.has(key)) {
                return;
            }

            seen.add(key);

            result.push(field);
        }


        function walk(value, depth = 0) {

            if (!value || depth > 5) {
                return;
            }


            if (Array.isArray(value)) {

                value.forEach(item => {

                    const field = normalizeField(item);

                    if (field) {
                        add(item);
                    } else {
                        walk(item, depth + 1);
                    }

                });

                return;
            }


            if (typeof value !== "object") {
                return;
            }


            for (const [key, child] of Object.entries(value)) {

                if (
                    [
                        "fields",
                        "columns",
                        "items",
                        "dimensions",
                        "measures",
                        "fieldDefinitions"
                    ].includes(key)
                ) {

                    if (Array.isArray(child)) {
                        child.forEach(add);
                    }

                    else if (
                        child &&
                        typeof child === "object"
                    ) {
                        Object.values(child).forEach(add);
                    }

                    continue;
                }


                const field = normalizeField(child);

                if (field) {
                    add(child);
                }

                else if (
                    child &&
                    typeof child === "object"
                ) {
                    walk(child, depth + 1);
                }
            }
        }


        if (data?.fields) {

            if (Array.isArray(data.fields)) {
                data.fields.forEach(add);
            }

            else if (
                typeof data.fields === "object"
            ) {
                Object.values(data.fields).forEach(add);
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

        const name =
            typeof value === "string"
                ? value
                : value?.name;


        if (!name) {
            return null;
        }


        return (
            olapFields.find(
                field => field.name === name
            ) ||

            olapFields.find(
                field =>
                    field.name.toLowerCase() ===
                    String(name).toLowerCase()
            ) ||

            olapFields.find(
                field =>
                    field.title === name
            ) ||

            null
        );
    }


    function resolveTechnicalField(value) {

        const field = findOlapField(value);

        return field
            ? field.name
            : String(value || "");
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


        const response = await fetch(
            "/api/iiko/olap",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify({
                    action: "fields",
                    reportType: "SALES",

                    ip: iikoConnection.ip,
                    port: iikoConnection.port,
                    login: iikoConnection.login,
                    password: iikoConnection.password
                })
            }
        );


        const data = await safeJson(response);


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


        return olapFields;
    }


    // ============================================================
    // CREATE OLAP BUILDER
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
            document.createElement("div");


        builder.id = "olap-builder";


        builder.innerHTML = `

            <div class="olap-builder">

                <h2>Конструктор OLAP</h2>

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


                        <label id="olap-filter-value-label">

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


        container.appendChild(builder);


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
            ($("olap-search")?.value || "")
                .trim()
                .toLowerCase();


        const filtered =
            olapFields.filter(field => {

                if (!search) {
                    return true;
                }


                return (
                    field.name
                        .toLowerCase()
                        .includes(search) ||

                    field.title
                        .toLowerCase()
                        .includes(search)
                );
            });


        if (!filtered.length) {

            container.innerHTML = `
                <div class="olap-empty">
                    Поля не найдены
                </div>
            `;

            return;
        }


        container.innerHTML =
            filtered.map(field => {

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


                return `

                    <button
                        type="button"
                        class="olap-field"
                        draggable="true"
                        data-field="${esc(field.name)}"
                    >

                        <span>

                            <strong>
                                ${esc(field.title)}
                            </strong>

                            <small>
                                ${esc(field.name)}
                            </small>

                        </span>


                        <span class="olap-flags">
                            ${esc(flags.join(" "))}
                        </span>

                    </button>

                `;

            }).join("");


        container
            .querySelectorAll(".olap-field")
            .forEach(button => {

                button.addEventListener(
                    "dragstart",
                    event => {

                        currentDrag = {
                            source: "available",
                            field:
                                button.dataset.field
                        };


                        event.dataTransfer.effectAllowed =
                            "copy";


                        event.dataTransfer.setData(
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
                    field => field !== name
                );
        }


        if (keep !== "columns") {

            olapColumns =
                olapColumns.filter(
                    field => field !== name
                );
        }


        if (keep !== "measures") {

            olapMeasures =
                olapMeasures.filter(
                    item => item.field !== name
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
            findOlapField(name);


        if (
            type === "measures" &&
            field &&
            field.aggregationAllowed === false &&
            field.isMeasure !== true
        ) {

            return;
        }


        removeFromOtherGroups(
            name,
            type
        );


        if (type === "rows") {

            if (!olapRows.includes(name)) {
                olapRows.push(name);
            }
        }


        if (type === "columns") {

            if (!olapColumns.includes(name)) {
                olapColumns.push(name);
            }
        }


        if (type === "measures") {

            if (
                !olapMeasures.some(
                    item => item.field === name
                )
            ) {

                olapMeasures.push({
                    field: name,
                    aggregation
                });
            }
        }


        renderSelectedFields();
    }


    // ============================================================
    // RENDER SELECTED
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
            values.map(
                (item, index) => {

                    const name =
                        type === "measures"
                            ? item.field
                            : item;


                    const field =
                        findOlapField(name);


                    return `

                        <div
                            class="olap-selected-field"
                            draggable="true"
                            data-type="${type}"
                            data-index="${index}"
                            data-field="${esc(name)}"
                        >

                            <span>

                                <strong>
                                    ${esc(
                                        field?.title ||
                                        name
                                    )}
                                </strong>

                                <small>
                                    ${esc(name)}

                                    ${
                                        type === "measures"
                                            ? ` • ${esc(item.aggregation)}`
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
            ).join("");


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


                        event.dataTransfer.effectAllowed =
                            "move";


                        event.dataTransfer.setData(
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

                    removeButton.onclick = () => {

                        const index =
                            Number(
                                element.dataset.index
                            );


                        if (type === "rows") {
                            olapRows.splice(index, 1);
                        }


                        if (type === "columns") {
                            olapColumns.splice(index, 1);
                        }


                        if (type === "measures") {
                            olapMeasures.splice(index, 1);
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
            ["olap-rows", "rows"],
            ["olap-columns", "columns"],
            ["olap-measures", "measures"]
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


                zone.dataset.dropBound = "1";


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
                            targetType === "measures" &&
                            field &&
                            field.aggregationAllowed === false &&
                            field.isMeasure !== true
                        ) {

                            return;
                        }


                        event.preventDefault();


                        event.dataTransfer.dropEffect =
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
                            targetType === "measures" &&
                            field &&
                            field.aggregationAllowed === false &&
                            field.isMeasure !== true
                        ) {

                            currentDrag = null;
                            return;
                        }


                        addOlapField(
                            targetType,
                            currentDrag.field,
                            "SUM"
                        );


                        currentDrag = null;
                    }
                );
            }
        );
    }


    // ============================================================
    // FILTERS
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
            available.map(
                field => `
                    <option value="${esc(field.name)}">
                        ${esc(field.title)}
                    </option>
                `
            ).join("");


        updateFilterInputMode();
    }


    function updateFilterInputMode() {

        const operator =
            $("olap-filter-operator")?.value;


        const dateRange =
            operator === "DateRange";


        const valueLabel =
            $("olap-filter-value-label");


        const fromLabel =
            $("olap-filter-from-label");


        const toLabel =
            $("olap-filter-to-label");


        if (valueLabel) {
            valueLabel.style.display =
                dateRange
                    ? "none"
                    : "block";
        }


        if (fromLabel) {
            fromLabel.style.display =
                dateRange
                    ? "block"
                    : "none";
        }


        if (toLabel) {
            toLabel.style.display =
                dateRange
                    ? "block"
                    : "none";
        }
    }


    function addOlapFilter() {

        const field =
            $("olap-filter-field")?.value;


        const operator =
            $("olap-filter-operator")?.value ||
            "Include";


        if (!field) {
            throw new Error(
                "Выберите поле для фильтра"
            );
        }


        if (
            operator === "DateRange"
        ) {

            const from =
                $("olap-filter-from")?.value;


            const to =
                $("olap-filter-to")?.value;


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
                field,
                operator,
                from,
                to
            });
        }


        else {

            const value =
                ($("olap-filter-value")?.value || "")
                    .trim();


            if (!value) {
                throw new Error(
                    "Укажите значение фильтра"
                );
            }


            if (
                operator === "IncludeList" ||
                operator === "ExcludeList"
            ) {

                const values =
                    value
                        .split(",")
                        .map(
                            item => item.trim()
                        )
                        .filter(Boolean);


                if (!values.length) {
                    throw new Error(
                        "Укажите значения"
                    );
                }


                olapFilters.push({
                    field,
                    operator,
                    values
                });
            }


            else {

                olapFilters.push({
                    field,
                    operator,
                    value
                });
            }
        }


        const valueElement =
            $("olap-filter-value");


        if (valueElement) {
            valueElement.value = "";
        }


        renderOlapFilters();
    }


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
            olapFilters.map(
                (filter, index) => {

                    const field =
                        findOlapField(
                            filter.field
                        );


                    let operator =
                        "Равно";


                    let value =
                        filter.value || "";


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
                            filter.values.join(
                                ", "
                            );
                    }


                    if (
                        filter.operator ===
                        "ExcludeList"
                    ) {

                        operator =
                            "Не в списке";

                        value =
                            filter.values.join(
                                ", "
                            );
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

                        <div class="olap-filter-item">

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
            ).join("");


        container
            .querySelectorAll(
                "[data-filter-index]"
            )
            .forEach(button => {

                button.onclick = () => {

                    const index =
                        Number(
                            button.dataset.filterIndex
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
    // CLEAR CONSTRUCTOR
    // ============================================================

    function clearOlap() {

        olapRows = [];
        olapColumns = [];
        olapMeasures = [];
        olapFilters = [];


        renderSelectedFields();
        renderOlapFilters();
    }


    // ============================================================
    // BUILD OLAP REQUEST
    // ============================================================

    function buildOlapRequest() {

        const from =
            $("olap-from")?.value || "";


        const to =
            $("olap-to")?.value || "";


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


        return {

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
                olapRows.map(
                    resolveTechnicalField
                ),


            groupByColumnFields:
                olapColumns.map(
                    resolveTechnicalField
                ),


            measures:
                olapMeasures.map(
                    item =>
                        item.field
                ),


            filters:
                olapFilters.map(
                    filter => ({
                        ...filter,

                        field:
                            resolveTechnicalField(
                                filter.field
                            )
                    })
                ),


            from,
            to,

            buildSummary:
                true
        };
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


            console.log(
                "IIKO OLAP REQUEST:",
                request
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


            renderOlapResult(data);
        }


        catch (error) {

            console.error(
                "OLAP ERROR:",
                error
            );


            if (result) {

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
                        🔴 ${esc(error.message)}
                    </div>

                    <pre>${esc(
                        JSON.stringify(
                            {
                                success: false,
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


        let rowsData;


        if (Array.isArray(raw)) {
            rowsData = raw;
        }

        else if (
            raw &&
            Array.isArray(raw.data)
        ) {
            rowsData = raw.data;
        }

        else {
            rowsData = [];
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


        const keys =
            [
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


            <div class="report-table-wrapper">

                <table class="report-table">

                    <thead>

                        <tr>

                            ${
                                keys.map(
                                    key => `
                                        <th>
                                            ${esc(key)}
                                        </th>
                                    `
                                ).join("")
                            }

                        </tr>

                    </thead>


                    <tbody>

                        ${
                            rowsData.map(
                                row => `

                                    <tr>

                                        ${
                                            keys.map(
                                                key => `
                                                    <td>
                                                        ${esc(
                                                            row?.[key]
                                                        )}
                                                    </td>
                                                `
                                            ).join("")
                                        }

                                    </tr>

                                `
                            ).join("")
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
            $("iiko-ip")?.value.trim();


        const port =
            $("iiko-port")?.value.trim();


        const login =
            $("iiko-login")?.value.trim();


        const password =
            $("iiko-password")?.value;


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
                $("remember-iiko")?.checked
            ) {

                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(
                        iikoConnection
                    )
                );
            }


            if ($("sales-card")) {

                $("sales-card").style.display =
                    "block";
            }


            setIikoStatus(
                "🟢 iiko подключён"
            );


            createOlapBuilder();


            olapFields =
                extractOlapFields(data);


            if (!olapFields.length) {
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
        }


        catch (error) {

            console.error(
                "IIKO CONNECT ERROR:",
                error
            );


            iikoConnection =
                null;


            setIikoStatus(
                "🔴 " + error.message
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
                JSON.parse(saved);


            // Восстанавливаем рабочее подключение, а не только
            // заполняем поля формы. Благодаря этому после F5
            // OLAP и другие запросы продолжают работать без
            // повторного нажатия «Подключиться».
            if (
                data &&
                data.ip &&
                data.port &&
                data.login &&
                data.password
            ) {
                iikoConnection = {
                    ip: String(data.ip),
                    port: String(data.port),
                    login: String(data.login),
                    password: String(data.password)
                };
            }


            [
                "ip",
                "port",
                "login",
                "password"
            ].forEach(key => {

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
            });


            if ($("remember-iiko")) {

                $("remember-iiko").checked =
                    true;
            }

            // Если подключение уже было сохранено, считаем его
            // восстановленным после перезагрузки страницы.
            if (iikoConnection) {
                setIikoStatus(
                    "🟢 iiko подключение восстановлено"
                );

                // На странице OLAP сразу получаем реальные поля
                // iiko, если конструктор присутствует.
                if ($("olap-search")) {
                    loadOlapFields()
                        .then(() => {
                            setIikoStatus(
                                "🟢 iiko подключён"
                            );
                        })
                        .catch(error => {
                            console.warn(
                                "Cannot restore OLAP fields",
                                error
                            );
                            setIikoStatus(
                                "🟡 Данные сохранены, но iiko сейчас недоступен"
                            );
                            setOlapStatus(
                                "🔴 " + error.message
                            );
                        });
                }
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
        ].forEach(key => {

            const element =
                $(
                    `iiko-${key}`
                );


            if (element) {
                element.value = "";
            }
        });


        if ($("remember-iiko")) {

            $("remember-iiko").checked =
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
            $("report-from")?.value;


        const to =
            $("report-to")?.value;


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
                        🔴 ${esc(error.message)}
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
            Array.isArray(raw.data)
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


        const keys =
            [
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

            <div class="report-table-wrapper">

                <table class="report-table">

                    <thead>
                        <tr>
                            ${
                                keys.map(
                                    key =>
                                        `<th>${esc(key)}</th>`
                                ).join("")
                            }
                        </tr>
                    </thead>


                    <tbody>

                        ${
                            raw.map(
                                row => `

                                    <tr>

                                        ${
                                            keys.map(
                                                key =>
                                                    `<td>${esc(row?.[key])}</td>`
                                            ).join("")
                                        }

                                    </tr>

                                `
                            ).join("")
                        }

                    </tbody>

                </table>

            </div>

        `;
    }


    // ============================================================
    // DEFAULT PERIODS
    // ============================================================

    function setDefaultPeriods() {

        const ids = [
            "report-from",
            "report-to",
            "olap-from",
            "olap-to"
        ];


        ids.forEach(id => {

            const element = $(id);

            if (
                element &&
                !element.value
            ) {

                element.value =
                    today();
            }
        });
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
