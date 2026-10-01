(function () {
    "use strict";

    const $ = id => document.getElementById(id);

    const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

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
    let olapFieldsLoadPromise = null;
    let olapActiveCategory = "all";
    let olapShowTechnical = false;
    let lastOlapRowsData = [];
    let selectedFieldMenu = null;
    const STORAGE_KEY = "iikoConnection";

    async function safeJson(response) {
        const text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); }
        catch { return { success: false, message: text || `HTTP ${response.status}` }; }
    }

    function setIikoStatus(text) { const element = $("iiko-status"); if (element) element.textContent = text; }
    function setOlapStatus(text) { const element = $("olap-status"); if (element) element.textContent = text; }

    function normalizeField(field) {
        if (typeof field === "string") {
            const name = field.trim();
            if (!name) return null;
            return { name, title: name, type: "", isMeasure: false, aggregationAllowed: false, groupingAllowed: true, filteringAllowed: true };
        }
        if (!field || typeof field !== "object") return null;
        const name = String(field.name || field.field || field.key || field.technicalName || field.code || field.id || "").trim();
        if (!name) return null;
        return {
            ...field,
            name,
            title: String(field.title || field.caption || field.label || field.displayName || name),
            type: String(field.type || field.dataType || field.kind || ""),
            isMeasure: field.isMeasure === true || field.measure === true || field.aggregationAllowed === true,
            aggregationAllowed: field.aggregationAllowed === true || field.allowAggregation === true || field.canAggregate === true,
            groupingAllowed: field.groupingAllowed !== false,
            filteringAllowed: field.filteringAllowed !== false
        };
    }

    function extractOlapFields(data) {
        const result = [];
        const seen = new Set();
        function add(value) {
            const field = normalizeField(value);
            if (!field) return;
            const key = field.name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            result.push(field);
        }
        function walk(value, depth = 0) {
            if (!value || depth > 5) return;
            if (Array.isArray(value)) { value.forEach(item => { const field = normalizeField(item); if (field) add(item); else walk(item, depth + 1); }); return; }
            if (typeof value !== "object") return;
            for (const [key, child] of Object.entries(value)) {
                if (["fields", "columns", "items", "dimensions", "measures", "fieldDefinitions"].includes(key)) {
                    if (Array.isArray(child)) child.forEach(add);
                    else if (child && typeof child === "object") Object.values(child).forEach(add);
                    continue;
                }
                const field = normalizeField(child);
                if (field) add(child); else if (child && typeof child === "object") walk(child, depth + 1);
            }
        }
        if (data?.fields) { if (Array.isArray(data.fields)) data.fields.forEach(add); else if (typeof data.fields === "object") Object.values(data.fields).forEach(add); }
        if (data?.raw) walk(data.raw);
        if (!result.length) walk(data);
        return result;
    }

    function findOlapField(value) {
        const name = typeof value === "string" ? value : value?.name;
        if (!name) return null;
        return olapFields.find(field => field.name === name) || olapFields.find(field => field.name.toLowerCase() === String(name).toLowerCase()) || olapFields.find(field => field.title === name) || null;
    }

    function resolveTechnicalField(value) {
        const field = findOlapField(value);
        return field ? field.name : String(value || "");
    }

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function refreshIikoConnectionFromServer(force = false) {
        if (!window.SH_ReportsContext?.prepare) return iikoConnection;
        const state = await window.SH_ReportsContext.prepare(force);
        const connection = state?.connection;
        if (connection?.ip && connection?.port && connection?.login && connection?.password) {
            iikoConnection = {
                ip: String(connection.ip),
                port: String(connection.port),
                login: String(connection.login),
                password: String(connection.password)
            };
        }
        return iikoConnection;
    }

    async function loadOlapFields(options = {}) {
        const force = options.force === true;
        const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
        if (!force && olapFieldsLoadPromise) return olapFieldsLoadPromise;

        const promise = (async () => {
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    if (!iikoConnection) await refreshIikoConnectionFromServer(attempt > 1);
                    if (!iikoConnection) throw new Error("Сохранённое подключение iiko ещё не готово");

                    setOlapStatus(
                        attempt === 1
                            ? "⏳ Загружаем поля OLAP..."
                            : `🟡 Повторная попытка загрузки полей OLAP (${attempt}/${maxAttempts})...`
                    );

                    const response = await fetch("/api/iiko/olap", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Accept": "application/json" },
                        credentials: "same-origin",
                        cache: "no-store",
                        body: JSON.stringify({
                            action: "fields",
                            reportType: "SALES",
                            ip: iikoConnection.ip,
                            port: iikoConnection.port,
                            login: iikoConnection.login,
                            password: iikoConnection.password
                        })
                    });
                    const data = await safeJson(response);
                    if (!response.ok || data.success === false) {
                        throw new Error(data.message || `OLAP fields HTTP ${response.status}`);
                    }

                    const fields = extractOlapFields(data);
                    if (!fields.length) throw new Error("iiko не вернул список OLAP полей");

                    olapFields = fields;
                    renderOlapFields();
                    renderFilterEditor();
                    setOlapStatus(`🟢 Доступные поля OLAP: ${olapFields.length}`);
                    return olapFields;
                } catch (error) {
                    lastError = error;
                    console.warn(`OLAP fields attempt ${attempt}/${maxAttempts} failed`, error);

                    if (attempt >= maxAttempts) break;

                    try {
                        await refreshIikoConnectionFromServer(true);
                    } catch (contextError) {
                        console.warn("Cannot refresh server-side iiko context", contextError);
                    }

                    await wait(attempt === 1 ? 600 : 1400);
                }
            }

            if (!olapFields.length) {
                const container = $("olap-fields");
                if (container) {
                    container.innerHTML = `<div class="olap-empty">Не удалось загрузить поля. Нажмите «Обновить поля».</div>`;
                }
            }
            setOlapStatus("🔴 " + (lastError?.message || "Не удалось загрузить OLAP-поля"));
            throw lastError || new Error("Не удалось загрузить OLAP-поля");
        })();

        olapFieldsLoadPromise = promise;
        try {
            return await promise;
        } finally {
            if (olapFieldsLoadPromise === promise) olapFieldsLoadPromise = null;
        }
    }

    const OLAP_CATEGORIES = [
        ["all", "Все"],
        ["dishes", "Блюда"],
        ["time", "Время"],
        ["guests", "Гости"],
        ["delivery", "Доставка"],
        ["orders", "Заказы"],
        ["payment", "Оплата"],
        ["organization", "Организация"],
        ["cost", "Себестоимость"],
        ["discounts", "Скидки"],
        ["staff", "Сотрудники"],
        ["other", "Прочее"]
    ];

    function olapFieldCategory(field) {
        const text = (String(field?.title || "") + " " + String(field?.name || "")).toLowerCase();
        if (/dish|product|item|menu|блюд|товар|номенклат|категор/.test(text)) return "dishes";
        if (/date|time|hour|day|week|month|year|open|close|дата|врем|час|день|недел|месяц/.test(text)) return "time";
        if (/guest|customer|client|гост|клиент/.test(text)) return "guests";
        if (/delivery|courier|достав|курьер/.test(text)) return "delivery";
        if (/order|check|bill|receipt|заказ|чек/.test(text)) return "orders";
        if (/payment|paytype|card|cash|оплат|налич|карт/.test(text)) return "payment";
        if (/employee|waiter|cashier|user|author|сотруд|официант|кассир/.test(text)) return "staff";
        if (/discount|markup|promo|coupon|скид|нацен|акци/.test(text)) return "discounts";
        if (/cost|foodcost|primecost|себестоим/.test(text)) return "cost";
        if (/store|department|terminal|cashregister|restaurant|conception|organization|склад|подраздел|касса|ресторан|организац/.test(text)) return "organization";
        return "other";
    }

    function isTechnicalOlapField(field) {
        const name = String(field?.name || "").toLowerCase();
        const title = String(field?.title || "").toLowerCase();
        return (
            /(^|[._])(id|guid|uuid|uniq[a-z]*|internal[a-z]*)([._]|$)/.test(name) ||
            /percentofsummary|typed$|\.typed|rowid|recordid/.test(name) ||
            (/^(id|guid|uuid)$/i.test(title.trim()))
        );
    }

    function createOlapBuilder() {
        const existing = $("olap-builder"); if (existing) return existing;
        const container = document.querySelector(".reports-container"); if (!container) return null;
        const builder = document.createElement("div"); builder.id = "olap-builder";
        builder.innerHTML = `
          <div class="olap-shell olap-v2">
            <div class="olap-report-head">
              <div>
                <div class="olap-report-title">OLAP отчёт по продажам</div>
                <div class="olap-report-subtitle">Быстрый конструктор отчётов</div>
              </div>
              <div class="olap-report-actions">
                <label class="olap-saved-wrap"><span>Сохранённые отчёты</span><select id="olap-saved-reports"><option value="">Выберите отчёт...</option></select></label>
                <button type="button" id="olap-save-report" class="olap-icon-btn" title="Сохранить отчёт">💾</button>
                <label class="olap-date-wrap"><span>Период с</span><input id="olap-from" type="date"></label>
                <label class="olap-date-wrap"><span>по</span><input id="olap-to" type="date"></label>
                <button type="button" id="olap-run" class="olap-primary">↻ Обновить</button>
                <button type="button" id="olap-export" class="olap-excel">▣ Excel</button>
              </div>
            </div>

            <div id="olap-status" class="olap-status">⏳ Подготавливаем поля OLAP...</div>

            <section class="olap-v2-fields">
              <div class="olap-v2-field-toolbar">
                <div id="olap-categories" class="olap-category-tabs"></div>
                <div class="olap-v2-search">
                  <input id="olap-search" type="search" placeholder="Поиск поля...">
                  <label class="olap-technical-toggle"><input id="olap-show-technical" type="checkbox"> Технические поля</label>
                  <button type="button" id="olap-refresh-fields">⟳</button>
                </div>
              </div>
              <div id="olap-fields" class="olap-fields olap-v2-field-list"><div class="olap-empty">Загрузка полей...</div></div>
            </section>

            <section class="olap-v2-config">
              <div class="olap-config-lane">
                <div class="olap-config-label">☷ Строки</div>
                <div id="olap-rows" class="olap-selected olap-v2-selected"><div class="olap-empty">Добавьте поле</div></div>
              </div>
              <div class="olap-config-lane">
                <div class="olap-config-label">▦ Колонки</div>
                <div id="olap-columns" class="olap-selected olap-v2-selected"><div class="olap-empty">Добавьте поле</div></div>
              </div>
              <div class="olap-config-lane">
                <div class="olap-config-label">Σ Показатели</div>
                <div id="olap-measures" class="olap-selected olap-v2-selected"><div class="olap-empty">Добавьте поле</div></div>
              </div>
              <div class="olap-config-actions">
                <button type="button" id="olap-add-filter" class="olap-filter-add">＋ Фильтр</button>
                <button type="button" id="olap-clear">Очистить</button>
              </div>
            </section>

            <div id="olap-filters" class="olap-filters-list olap-v2-filter-chips"><div class="olap-empty">Фильтры не заданы</div></div>

            <section class="olap-result-card olap-v2-result">
              <div class="olap-result-heading">
                <div>
                  <div class="olap-card-title">Результат отчёта</div>
                  <div class="olap-result-hint">Раскрывайте группы стрелками. Фильтры доступны через ⋮ у выбранного поля.</div>
                </div>
              </div>
              <div id="olap-result" class="olap-result">
                <div class="olap-result-empty"><div class="olap-result-icon">▦</div><strong>Отчёт ещё не сформирован</strong><span>Добавьте поля и нажмите «Обновить».</span></div>
              </div>
            </section>
          </div>

          <div id="olap-filter-modal" class="olap-v2-modal" hidden>
            <div class="olap-v2-modal-backdrop" data-close-filter></div>
            <div class="olap-v2-modal-card" role="dialog" aria-modal="true">
              <div class="olap-v2-modal-head"><strong>Фильтр</strong><button type="button" data-close-filter>×</button></div>
              <div class="olap-v2-modal-body">
                <label>Поле<select id="olap-filter-field"></select></label>
                <label>Условие<select id="olap-filter-operator">
                  <option value="Include">Равно</option>
                  <option value="Exclude">Не равно</option>
                  <option value="IncludeList">В списке</option>
                  <option value="ExcludeList">Не в списке</option>
                  <option value="DateRange">Диапазон дат</option>
                </select></label>
                <label id="olap-filter-value-label">Значение<input id="olap-filter-value" type="text" placeholder="Введите значение"></label>
                <label id="olap-filter-from-label" style="display:none">От<input id="olap-filter-from" type="date"></label>
                <label id="olap-filter-to-label" style="display:none">До<input id="olap-filter-to" type="date"></label>
                <div id="olap-filter-suggestions" class="olap-filter-suggestions"></div>
              </div>
              <div class="olap-v2-modal-actions"><button type="button" data-close-filter>Отмена</button><button type="button" id="olap-apply-filter" class="olap-primary">Применить</button></div>
            </div>
          </div>
        `;
        container.appendChild(builder);
        renderOlapCategories();
        bindOlapEvents();
        return builder;
    }

    function renderOlapCategories() {
        const host = $("olap-categories"); if (!host) return;
        host.innerHTML = OLAP_CATEGORIES.map(([key,label]) =>
            `<button type="button" class="olap-category-tab ${olapActiveCategory===key?"active":""}" data-category="${esc(key)}">${esc(label)}</button>`
        ).join("");
        host.querySelectorAll("[data-category]").forEach(btn => btn.onclick = () => {
            olapActiveCategory = btn.dataset.category || "all";
            renderOlapCategories();
            renderOlapFields();
        });
    }

    function renderOlapFields() {    function renderOlapFields() {
        const container = $("olap-fields"); if (!container) return;
        const search = ($("olap-search")?.value || "").trim().toLowerCase();
        const filtered = olapFields.filter(field => {
            const technical = isTechnicalOlapField(field);
            if (!olapShowTechnical && technical) return false;
            const category = olapFieldCategory(field);
            if (olapActiveCategory !== "all" && category !== olapActiveCategory) return false;
            return !search || field.name.toLowerCase().includes(search) || field.title.toLowerCase().includes(search);
        });
        if (!filtered.length) { container.innerHTML = `<div class="olap-empty">Поля не найдены</div>`; return; }

        container.innerHTML = filtered.map(field => {
            const canMeasure = field.aggregationAllowed || field.isMeasure;
            return `<div class="olap-field olap-v2-field" draggable="true" data-field="${esc(field.name)}">
                <div class="olap-v2-field-name"><strong>${esc(field.title)}</strong><small>${esc(field.name)}</small></div>
                <div class="olap-v2-field-actions">
                  <button type="button" data-add-row title="В строки">Строка</button>
                  <button type="button" data-add-column title="В колонки">Колонка</button>
                  <button type="button" data-add-measure title="В показатели" ${canMeasure?"":"disabled"}>Σ</button>
                  <button type="button" data-add-filter-field title="Фильтр" ${field.filteringAllowed===false?"disabled":""}>⌕</button>
                </div>
              </div>`;
        }).join("");

        container.querySelectorAll(".olap-field").forEach(card => {
            const name = card.dataset.field;
            card.addEventListener("dragstart", event => {
                currentDrag = { source: "available", field: name };
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/plain", name);
            });
            card.querySelector("[data-add-row]")?.addEventListener("click", e => { e.stopPropagation(); addOlapField("rows", name); });
            card.querySelector("[data-add-column]")?.addEventListener("click", e => { e.stopPropagation(); addOlapField("columns", name); });
            card.querySelector("[data-add-measure]")?.addEventListener("click", e => { e.stopPropagation(); addOlapField("measures", name); });
            card.querySelector("[data-add-filter-field]")?.addEventListener("click", e => { e.stopPropagation(); openOlapFilter(name); });
        });
    }

    function removeFromOtherGroups(fieldName, keep) {
        const name = resolveTechnicalField(fieldName);
        if (keep !== "rows") olapRows = olapRows.filter(field => field !== name);
        if (keep !== "columns") olapColumns = olapColumns.filter(field => field !== name);
        if (keep !== "measures") olapMeasures = olapMeasures.filter(item => item.field !== name);
    }

    function addOlapField(type, fieldName, aggregation = "SUM") {
        const name = resolveTechnicalField(fieldName); if (!name) return;
        const field = findOlapField(name);
        if (type === "measures" && field && field.aggregationAllowed === false && field.isMeasure !== true) return;
        removeFromOtherGroups(name, type);
        if (type === "rows" && !olapRows.includes(name)) olapRows.push(name);
        if (type === "columns" && !olapColumns.includes(name)) olapColumns.push(name);
        if (type === "measures" && !olapMeasures.some(item => item.field === name)) olapMeasures.push({ field: name, aggregation });
        renderSelectedFields();
    }

    function renderSelectedFields() { renderSelectedGroup("olap-rows", "rows", olapRows); renderSelectedGroup("olap-columns", "columns", olapColumns); renderSelectedGroup("olap-measures", "measures", olapMeasures); }

    function renderSelectedGroup(elementId, type, values) {
        const container = $(elementId); if (!container) return;
        if (!values.length) { container.innerHTML = `<div class="olap-empty">Добавьте поле</div>`; bindOlapDropZones(); return; }

        container.innerHTML = values.map((item, index) => {
            const name = type === "measures" ? item.field : item;
            const field = findOlapField(name);
            return `<div class="olap-selected-field olap-v2-chip" draggable="true" data-type="${type}" data-index="${index}" data-field="${esc(name)}">
              <span class="olap-chip-label"><strong>${esc(field?.title || name)}</strong>${type === "measures" ? `<small>${esc(item.aggregation || "SUM")}</small>` : ""}</span>
              <button type="button" class="olap-chip-menu-btn" data-chip-menu aria-label="Меню">⋮</button>
            </div>`;
        }).join("");

        container.querySelectorAll(".olap-selected-field").forEach(element => {
            element.addEventListener("dragstart", event => {
                currentDrag = { source: element.dataset.type, index: Number(element.dataset.index), field: element.dataset.field };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", element.dataset.field);
            });
            element.querySelector("[data-chip-menu]")?.addEventListener("click", event => {
                event.stopPropagation();
                openSelectedFieldMenu(element, type, Number(element.dataset.index), element.dataset.field);
            });
        });
        bindOlapDropZones();
    }

    function closeSelectedFieldMenu() {
        document.querySelectorAll(".olap-chip-menu").forEach(node => node.remove());
        selectedFieldMenu = null;
    }

    function moveSelectedField(type,index,direction) {
        const list = type === "rows" ? olapRows : type === "columns" ? olapColumns : olapMeasures;
        const next = index + direction;
        if (next < 0 || next >= list.length) return;
        [list[index], list[next]] = [list[next], list[index]];
        renderSelectedFields();
    }

    function removeSelectedField(type,index) {
        if (type === "rows") olapRows.splice(index,1);
        if (type === "columns") olapColumns.splice(index,1);
        if (type === "measures") olapMeasures.splice(index,1);
        renderSelectedFields();
    }

    function openSelectedFieldMenu(anchor,type,index,fieldName) {
        closeSelectedFieldMenu();
        const menu = document.createElement("div");
        menu.className = "olap-chip-menu";
        const measure = type === "measures" ? olapMeasures[index] : null;
        menu.innerHTML = `
          <button type="button" data-menu-filter>⌕ Фильтр</button>
          <button type="button" data-menu-left>← Переместить левее</button>
          <button type="button" data-menu-right>→ Переместить правее</button>
          ${type === "measures" ? `<div class="olap-menu-section"><span>Агрегация</span>
            <select data-menu-aggregation>
              ${["SUM","AVG","MIN","MAX","COUNT"].map(x=>`<option value="${x}" ${String(measure?.aggregation||"SUM").toUpperCase()===x?"selected":""}>${x}</option>`).join("")}
            </select></div>` : ""}
          <button type="button" data-menu-remove class="danger">× Удалить поле</button>
        `;
        document.body.appendChild(menu);
        const rect = anchor.getBoundingClientRect();
        menu.style.left = Math.max(8,Math.min(window.innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+"px";
        menu.style.top = Math.min(window.innerHeight-menu.offsetHeight-8,rect.bottom+6)+"px";
        selectedFieldMenu = menu;

        menu.querySelector("[data-menu-filter]")?.addEventListener("click",()=>{closeSelectedFieldMenu();openOlapFilter(fieldName)});
        menu.querySelector("[data-menu-left]")?.addEventListener("click",()=>{moveSelectedField(type,index,-1);closeSelectedFieldMenu()});
        menu.querySelector("[data-menu-right]")?.addEventListener("click",()=>{moveSelectedField(type,index,1);closeSelectedFieldMenu()});
        menu.querySelector("[data-menu-remove]")?.addEventListener("click",()=>{removeSelectedField(type,index);closeSelectedFieldMenu()});
        const aggregation=menu.querySelector("[data-menu-aggregation]");
        if(aggregation) aggregation.onchange=()=>{olapMeasures[index].aggregation=aggregation.value;renderSelectedFields();closeSelectedFieldMenu()};
    }

    function bindOlapDropZones() {
        const zones = [["olap-rows", "rows"], ["olap-columns", "columns"], ["olap-measures", "measures"]];
        zones.forEach(([elementId, targetType]) => { const zone = $(elementId); if (!zone || zone.dataset.dropBound === "1") return; zone.dataset.dropBound = "1"; zone.addEventListener("dragover", event => { if (!currentDrag || !currentDrag.field) return; const field = findOlapField(currentDrag.field); if (targetType === "measures" && field && field.aggregationAllowed === false && field.isMeasure !== true) return; event.preventDefault(); event.dataTransfer.dropEffect = currentDrag.source === "available" ? "copy" : "move"; zone.classList.add("olap-drop-active"); }); zone.addEventListener("dragleave", event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("olap-drop-active"); }); zone.addEventListener("drop", event => { event.preventDefault(); zone.classList.remove("olap-drop-active"); if (!currentDrag || !currentDrag.field) return; const field = findOlapField(currentDrag.field); if (targetType === "measures" && field && field.aggregationAllowed === false && field.isMeasure !== true) { currentDrag = null; return; } addOlapField(targetType, currentDrag.field, "SUM"); currentDrag = null; }); });
    }

    function renderFilterEditor() {
        const select = $("olap-filter-field"); if (!select) return;
        const available = olapFields.filter(field => field.filteringAllowed !== false && (olapShowTechnical || !isTechnicalOlapField(field)));
        const current = select.value;
        select.innerHTML = available.map(field => `<option value="${esc(field.name)}">${esc(field.title)}</option>`).join("");
        if ([...select.options].some(o=>o.value===current)) select.value=current;
        updateFilterInputMode();
    }

    function filterValuesFromLastResult(fieldName) {
        const values = [];
        const seen = new Set();
        lastOlapRowsData.forEach(row => {
            const v = row?.[fieldName];
            if (v === null || v === undefined || v === "") return;
            const key = String(v);
            if (seen.has(key)) return;
            seen.add(key); values.push(key);
        });
        return values.sort((a,b)=>a.localeCompare(b,"ru")).slice(0,100);
    }

    function renderFilterSuggestions(fieldName) {
        const host = $("olap-filter-suggestions"); if (!host) return;
        const values = filterValuesFromLastResult(fieldName);
        if (!values.length) {
            host.innerHTML = '<div class="olap-filter-suggestion-empty">После первого запуска отчёта здесь появятся найденные значения для быстрого выбора.</div>';
            return;
        }
        host.innerHTML = '<div class="olap-filter-suggestion-title">Значения из текущего отчёта</div><div class="olap-filter-suggestion-values">'+
            values.map(v=>`<button type="button" data-filter-value="${esc(v)}">${esc(v)}</button>`).join("")+'</div>';
        host.querySelectorAll("[data-filter-value]").forEach(btn=>btn.onclick=()=>{
            const input=$("olap-filter-value"); if(!input)return;
            const op=$("olap-filter-operator")?.value;
            if(op==="IncludeList"||op==="ExcludeList"){
                const current=input.value.split(",").map(x=>x.trim()).filter(Boolean);
                if(!current.includes(btn.dataset.filterValue))current.push(btn.dataset.filterValue);
                input.value=current.join(", ");
            }else input.value=btn.dataset.filterValue;
        });
    }

    function openOlapFilter(fieldName="") {
        const modal=$("olap-filter-modal"); if(!modal)return;
        renderFilterEditor();
        if(fieldName && [...$("olap-filter-field").options].some(o=>o.value===fieldName)) $("olap-filter-field").value=fieldName;
        $("olap-filter-value").value="";
        $("olap-filter-from").value="";
        $("olap-filter-to").value="";
        updateFilterInputMode();
        renderFilterSuggestions($("olap-filter-field").value);
        modal.hidden=false;
        document.body.classList.add("olap-modal-open");
    }

    function closeOlapFilter() {
        const modal=$("olap-filter-modal"); if(modal)modal.hidden=true;
        document.body.classList.remove("olap-modal-open");
    }

    function updateFilterInputMode() {
        const operator = $("olap-filter-operator")?.value; const dateRange = operator === "DateRange";
        const valueLabel = $("olap-filter-value-label"); const fromLabel = $("olap-filter-from-label"); const toLabel = $("olap-filter-to-label");
        if (valueLabel) valueLabel.style.display = dateRange ? "none" : "block";
        if (fromLabel) fromLabel.style.display = dateRange ? "block" : "none";
        if (toLabel) toLabel.style.display = dateRange ? "block" : "none";
    }

    function addOlapFilter() {
        const field = $("olap-filter-field")?.value; const operator = $("olap-filter-operator")?.value || "Include";
        if (!field) throw new Error("Выберите поле для фильтра");
        if (operator === "DateRange") {
            const from = $("olap-filter-from")?.value; const to = $("olap-filter-to")?.value;
            if (!from || !to) throw new Error("Укажите обе даты фильтра");
            if (from > to) throw new Error("Неверный диапазон дат");
            olapFilters.push({ field, operator, from, to });
        } else {
            const value = ($("olap-filter-value")?.value || "").trim();
            if (!value) throw new Error("Укажите значение фильтра");
            if (operator === "IncludeList" || operator === "ExcludeList") {
                const values = value.split(",").map(item => item.trim()).filter(Boolean);
                if (!values.length) throw new Error("Укажите значения");
                olapFilters.push({ field, operator, values });
            } else olapFilters.push({ field, operator, value });
        }
        const valueElement = $("olap-filter-value"); if (valueElement) valueElement.value = "";
        renderOlapFilters();
        closeOlapFilter();
    }

    function renderOlapFilters() {
        const container = $("olap-filters"); if (!container) return;
        if (!olapFilters.length) { container.innerHTML = `<div class="olap-empty">Фильтры не заданы</div>`; return; }
        container.innerHTML = olapFilters.map((filter, index) => {
            const field = findOlapField(filter.field);
            let operator = "Равно"; let value = filter.value || "";
            if (filter.operator === "Exclude") operator = "Не равно";
            if (filter.operator === "IncludeList") { operator = "В списке"; value = (filter.values||[]).join(", "); }
            if (filter.operator === "ExcludeList") { operator = "Не в списке"; value = (filter.values||[]).join(", "); }
            if (filter.operator === "DateRange") { operator = "Диапазон"; value = `${filter.from} — ${filter.to}`; }
            return `<div class="olap-filter-item olap-v2-filter-chip">
              <span><strong>${esc(field?.title || filter.field)}</strong><small>${esc(operator)} · ${esc(value)}</small></span>
              <button type="button" data-filter-index="${index}" title="Удалить фильтр">×</button>
            </div>`;
        }).join("");
        container.querySelectorAll("[data-filter-index]").forEach(button => button.onclick = () => {
            olapFilters.splice(Number(button.dataset.filterIndex), 1);
            renderOlapFilters();
        });
    }

    function clearOlap() { olapRows = []; olapColumns = []; olapMeasures = []; olapFilters = []; renderSelectedFields(); renderOlapFilters(); }

    function buildOlapRequest() {
        const from = $("olap-from")?.value || ""; const to = $("olap-to")?.value || "";
        if (!olapRows.length && !olapColumns.length && !olapMeasures.length) throw new Error("Выберите хотя бы одно поле в Строки, Колонки или Показатели");
        if (from && to && from > to) throw new Error("Неверный период");
        return {
            action: "query", reportType: "SALES",
            ip: iikoConnection.ip, port: iikoConnection.port, login: iikoConnection.login, password: iikoConnection.password,
            groupByRowFields: olapRows.map(resolveTechnicalField),
            groupByColumnFields: olapColumns.map(resolveTechnicalField),
            measures: olapMeasures.map(item => resolveTechnicalField(item.field)),
            filters: olapFilters.map(filter => ({ ...filter, field: resolveTechnicalField(filter.field) })),
            from, to, buildSummary: true
        };
    }

    async function runOlap() {
        const result = $("olap-result");
        try {
            if (!iikoConnection) throw new Error("Сначала подключитесь к iiko");
            const request = buildOlapRequest();
            if (result) result.innerHTML = `<div class="report-loading">⏳ Получаем данные из iiko...</div>`;
            console.log("IIKO OLAP REQUEST:", request);
            const response = await fetch("/api/iiko/olap", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(request) });
            const data = await safeJson(response);
            console.log("IIKO OLAP RESPONSE:", data);
            if (!response.ok || data.success === false) throw new Error(data.message || data.rawResponse || `iiko OLAP HTTP ${response.status}`);
            renderOlapResult(data);
        } catch (error) {
            console.error("OLAP ERROR:", error);
            if (result) result.innerHTML = `<div class="report-error">🔴 ${esc(error.message)}</div><pre>${esc(JSON.stringify({ success: false, message: error.message, request: (() => { try { return buildOlapRequest(); } catch { return { groupByRowFields: olapRows, groupByColumnFields: olapColumns, measures: olapMeasures, filters: olapFilters }; } })() }, null, 2))}</pre>`;
        }
    }

    function getOlapFieldTitle(name) { const field = findOlapField(name); return field?.title || String(name || ""); }
    function getOlapMeasureTitle(item) { const field = findOlapField(item?.field || item); const title = field?.title || item?.field || item || ""; const aggregation = String(item?.aggregation || "SUM").toUpperCase(); if (aggregation === "SUM") return title; const names = { AVG: "Среднее", MIN: "Минимум", MAX: "Максимум", COUNT: "Количество" }; return `${names[aggregation] || aggregation}: ${title}`; }
    function olapValueKey(value) { if (value === null || value === undefined) return ""; if (typeof value === "object") { try { return JSON.stringify(value); } catch (_) { return String(value); } } return String(value); }
    function aggregateOlapValue(current, value, aggregation) { const op = String(aggregation || "SUM").toUpperCase(); const n = Number(value); if (op === "COUNT") return (Number(current) || 0) + 1; if (!Number.isFinite(n)) return current ?? value ?? ""; if (current === undefined || current === null || current === "") return n; const c = Number(current); if (!Number.isFinite(c)) return n; if (op === "MIN") return Math.min(c, n); if (op === "MAX") return Math.max(c, n); return c + n; }
    function formatOlapValue(value) { if (value === null || value === undefined) return ""; if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))); return String(value); }

    function buildGroupedOlapResult(rowsData) {
        const rowFields = [...olapRows], columnFields = [...olapColumns], measures = [...olapMeasures], dimensions = [...olapRows, ...olapColumns];
        if (!dimensions.length) return { displayRows: rowsData.map(row => ({ kind: "data", row })), leafCount: rowsData.length };
        const groups = new Map();
        rowsData.forEach((row, index) => { const key = dimensions.map(field => olapValueKey(row?.[field])).join("\u001f"); if (!groups.has(key)) groups.set(key, { first: row, values: {}, order: index }); const group = groups.get(key); measures.forEach(measure => { const field = measure.field; group.values[field] = aggregateOlapValue(group.values[field], row?.[field], measure.aggregation); }); });
        const leafGroups = [...groups.values()].sort((a,b) => a.order - b.order); const displayRows = [];
        if (!rowFields.length) { leafGroups.forEach(group => displayRows.push({ kind: "data", row: { ...group.first, ...group.values } })); return { displayRows, leafCount: leafGroups.length }; }
        const topField = rowFields[0], topGroups = new Map();
        leafGroups.forEach(group => { const key = olapValueKey(group.first?.[topField]); if (!topGroups.has(key)) topGroups.set(key, []); topGroups.get(key).push(group); });
        for (const [, items] of topGroups) { items.forEach(group => displayRows.push({ kind: "data", row: { ...group.first, ...group.values } })); const subtotal = {}; subtotal[topField] = `${items[0]?.first?.[topField] ?? ""} всего`; rowFields.slice(1).forEach(field => subtotal[field] = ""); columnFields.forEach(field => subtotal[field] = ""); measures.forEach(measure => { let value; items.forEach(group => { value = aggregateOlapValue(value, group.values[measure.field], measure.aggregation); }); subtotal[measure.field] = value; }); displayRows.push({ kind: "subtotal", row: subtotal }); }
        return { displayRows, leafCount: leafGroups.length };
    }

    function renderOlapResult(data) {
        const result = $("olap-result"); if (!result) return;
        const report = data.report || data; let raw = report.rawResponse || report.response || report.data || data.data || [];
        if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (_) { raw = []; } }
        const rowsData = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];
        if (!rowsData.length) { result.innerHTML = `<div class="report-header"><strong>Отчёт выполнен</strong></div><div class="olap-empty">iiko не вернул строки данных.</div>`; return; }
        const rowFields = [...olapRows], columnFields = [...olapColumns], measures = [...olapMeasures];
        const keys = [...new Set([...rowFields, ...columnFields, ...measures.map(item => item.field)])];
        const visibleKeys = keys.length ? keys : [...new Set(rowsData.flatMap(row => Object.keys(row || {})))];
        const fieldTitle = key => { const measure = measures.find(item => item.field === key); if (measure) return getOlapMeasureTitle(measure); return getOlapFieldTitle(key); };
        const value = (row, field) => { if (!row) return ""; if (Object.prototype.hasOwnProperty.call(row, field)) return row[field]; const found = findOlapField(field); if (found?.title && Object.prototype.hasOwnProperty.call(row, found.title)) return row[found.title]; return ""; };
        const groupKey = (row, field) => String(value(row, field) ?? "").trim();
        const aggregate = (rows, measure) => { const vals = rows.map(row => Number(value(row, measure.field))).filter(Number.isFinite); if (!vals.length) return ""; switch (String(measure.aggregation || "SUM").toUpperCase()) { case "AVG": case "AVERAGE": return vals.reduce((a,b) => a+b, 0) / vals.length; case "MIN": return Math.min(...vals); case "MAX": return Math.max(...vals); case "COUNT": return vals.length; default: return vals.reduce((a,b) => a+b, 0); } };
        const format = v => formatOlapValue(v);
        const buildTree = (rows, depth) => { if (depth >= rowFields.length) return { rows }; const field = rowFields[depth], map = new Map(); rows.forEach((row, index) => { const key = groupKey(row, field); if (!map.has(key)) map.set(key, { key, rows: [], order: index }); map.get(key).rows.push(row); }); return { field, groups: [...map.values()].sort((a,b) => a.order - b.order).map(group => ({ ...group, child: buildTree(group.rows, depth + 1) })) }; };
        const root = buildTree(rowsData, 0), htmlRows = [];
        const makeGroupTotal = (groupRows, label) => htmlRows.push(`<tr class="olap-group-total">${visibleKeys.map((key, index) => { if (index === 0) return `<td class="olap-total-label" colspan="${Math.max(1, rowFields.length)}"><strong>${esc(label)} всего</strong></td>`; if (rowFields.includes(key)) return ""; const measure = measures.find(item => item.field === key); return measure ? `<td><strong>${esc(format(aggregate(groupRows, measure)))} </strong></td>` : `<td></td>`; }).join("")}</tr>`);
        const renderLeafRows = rows => rows.forEach(row => htmlRows.push(`<tr class="olap-data-row">${visibleKeys.map(key => rowFields.includes(key) ? `<td></td>` : `<td>${esc(format(value(row, key)))}</td>`).join("")}</tr>`));
        const renderLevel = (node, depth, parentRows) => { if (!node || !node.groups) { renderLeafRows(node?.rows || parentRows || []); return; } node.groups.forEach(group => { htmlRows.push(`<tr class="olap-group-row" data-olap-level="${depth}">${visibleKeys.map((key, index) => { if (index === depth && rowFields.includes(key)) return `<td class="olap-group-label"><button type="button" class="olap-group-toggle" aria-expanded="true" tabindex="-1">▼</button><strong>${esc(group.key)}</strong></td>`; if (rowFields.includes(key)) return `<td></td>`; return `<td></td>`; }).join("")}</tr>`); if (group.child?.groups) renderLevel(group.child, depth + 1, group.rows); else renderLeafRows(group.child?.rows || group.rows); makeGroupTotal(group.rows, group.key, depth); }); };
        if (rowFields.length) renderLevel(root, 0, rowsData); else renderLeafRows(rowsData);
        if (measures.length && rowFields.length) htmlRows.push(`<tr class="olap-grand-total">${visibleKeys.map((key, index) => { if (index === 0) return `<td class="olap-total-label" colspan="${Math.max(1, rowFields.length)}"><strong>Итого</strong></td>`; if (rowFields.includes(key)) return ""; const measure = measures.find(item => item.field === key); return measure ? `<td><strong>${esc(format(aggregate(rowsData, measure)))}</strong></td>` : `<td></td>`; }).join("")}</tr>`);
        result.innerHTML = `<div class="report-header"><strong>Результат OLAP</strong><span>${rowsData.length} строк</span></div><div class="report-table-wrapper"><table class="report-table olap-grouped-report"><thead><tr>${visibleKeys.map(key => `<th>${esc(fieldTitle(key))}</th>`).join("")}</tr></thead><tbody>${htmlRows.join("")}</tbody></table></div>`;
    }

    async function connectIiko() {
        const ip = $("iiko-ip")?.value.trim(), port = $("iiko-port")?.value.trim(), login = $("iiko-login")?.value.trim(), password = $("iiko-password")?.value;
        if (!ip || !port || !login || !password) { setIikoStatus("⚠️ Заполните IP, порт, логин и пароль"); return; }
        iikoConnection = { ip, port, login, password }; setIikoStatus("⏳ Подключение к iiko...");
        try {
            const response = await fetch("/api/iiko/olap", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ action: "fields", reportType: "SALES", ip, port, login, password }) });
            const data = await safeJson(response); if (!response.ok || data.success === false) throw new Error(data.message || `HTTP ${response.status}`);
            if ($("remember-iiko")?.checked) localStorage.setItem(STORAGE_KEY, JSON.stringify(iikoConnection));
            if ($("sales-card")) $("sales-card").style.display = "block";
            setIikoStatus("🟢 iiko подключён"); createOlapBuilder(); olapFields = extractOlapFields(data); if (!olapFields.length) await loadOlapFields(); else { renderOlapFields(); renderFilterEditor(); setOlapStatus(`🟢 Доступные поля OLAP: ${olapFields.length}`); } setDefaultPeriods();
        } catch (error) { console.error("IIKO CONNECT ERROR:", error); iikoConnection = null; setIikoStatus("🔴 " + error.message); }
    }

    function loadSavedIikoData() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY); if (!saved) return; const data = JSON.parse(saved);
            if (data && data.ip && data.port && data.login && data.password) iikoConnection = { ip: String(data.ip), port: String(data.port), login: String(data.login), password: String(data.password) };
            ["ip", "port", "login", "password"].forEach(key => { const element = $(`iiko-${key}`); if (element && data[key] != null) element.value = data[key]; });
            if ($("remember-iiko")) $("remember-iiko").checked = true;
            if (iikoConnection) { setIikoStatus("🟢 iiko подключение восстановлено"); if ($("olap-search")) loadOlapFields().then(() => setIikoStatus("🟢 iiko подключён")).catch(error => { console.warn("Cannot restore OLAP fields", error); setIikoStatus("🟡 Данные сохранены, но iiko сейчас недоступен"); setOlapStatus("🔴 " + error.message); }); }
        } catch (error) { console.warn("Cannot load saved iiko data", error); }
    }

    function clearSavedIikoData() { localStorage.removeItem(STORAGE_KEY); ["ip", "port", "login", "password"].forEach(key => { const element = $(`iiko-${key}`); if (element) element.value = ""; }); if ($("remember-iiko")) $("remember-iiko").checked = false; iikoConnection = null; setIikoStatus("⚪ Сохранённые данные очищены"); }

    async function loadSalesReport() {
        const result = $("sales-result"); if (!iikoConnection) { if (result) result.innerHTML = `<div class="report-error">⚠️ Сначала подключитесь к iiko</div>`; return; }
        const from = $("report-from")?.value, to = $("report-to")?.value; if (!from || !to || from > to) { if (result) result.innerHTML = `<div class="report-error">⚠️ Выберите правильный период</div>`; return; }
        if (result) result.innerHTML = `<div class="report-loading">⏳ Получаем данные из iiko...</div>`;
        try { const response = await fetch("/api/iiko/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: iikoConnection.ip, port: iikoConnection.port, login: iikoConnection.login, password: iikoConnection.password, from, to }) }); const data = await safeJson(response); if (!response.ok || data.success === false) throw new Error(data.message || "Ошибка получения продаж"); renderSalesReport(data); }
        catch (error) { if (result) result.innerHTML = `<div class="report-error">🔴 ${esc(error.message)}</div>`; }
    }

    function renderSalesReport(data) {
        const result = $("sales-result"); if (!result) return; const report = data.report || data; let raw = report.rawResponse || report.data || data.data || []; if (raw && !Array.isArray(raw) && Array.isArray(raw.data)) raw = raw.data; if (!Array.isArray(raw)) raw = []; if (!raw.length) { result.innerHTML = `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`; return; } const keys = [...new Set(raw.flatMap(row => Object.keys(row || {})))]; result.innerHTML = `<div class="report-table-wrapper"><table class="report-table"><thead><tr>${keys.map(key => `<th>${esc(key)}</th>`).join("")}</tr></thead><tbody>${raw.map(row => `<tr>${keys.map(key => `<td>${esc(row?.[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function setDefaultPeriods() { ["report-from", "report-to", "olap-from", "olap-to"].forEach(id => { const element = $(id); if (element && !element.value) element.value = today(); }); }
    function savedReportsKey() { const user = window.SH_CURRENT_USER || {}; return `SH_Reports.savedOlap.${user.id || user.email || "local"}`; }
    function getSavedReports() { try { return JSON.parse(localStorage.getItem(savedReportsKey()) || "[]"); } catch { return []; } }
    function renderSavedReports() { const select = $("olap-saved-reports"); if (!select) return; const current = select.value; select.innerHTML = `<option value="">Выберите отчёт...</option>` + getSavedReports().map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join(""); if ([...select.options].some(o => o.value === current)) select.value = current; }
    function saveCurrentOlapReport() { const name = window.prompt("Название отчёта:", "Мой OLAP отчёт"); if (!name || !name.trim()) return; const reports = getSavedReports(); reports.push({ name: name.trim(), rows: [...olapRows], columns: [...olapColumns], measures: olapMeasures.map(x => ({...x})), filters: olapFilters.map(x => ({...x})), createdAt: new Date().toISOString() }); localStorage.setItem(savedReportsKey(), JSON.stringify(reports)); renderSavedReports(); const select = $("olap-saved-reports"); if (select) select.value = String(reports.length - 1); }
    function loadSavedOlapReport(index) { if (index === "") return; const report = getSavedReports()[Number(index)]; if (!report) return; olapRows = [...(report.rows || [])]; olapColumns = [...(report.columns || [])]; olapMeasures = (report.measures || []).map(x => ({...x})); olapFilters = (report.filters || []).map(x => ({...x})); renderSelectedFields(); renderOlapFilters(); }
    function exportOlapCsv() { const table = $("olap-result")?.querySelector("table"); if (!table) { setOlapStatus("⚠️ Сначала сформируйте отчёт"); return; } const rows = [...table.rows].map(row => [...row.cells].map(cell => `"${String(cell.innerText).replace(/"/g, '""')}"`).join(";")); const blob = new Blob(["\ufeff" + rows.join("\n")], {type: "text/csv;charset=utf-8;"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "olap-report.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

    function bindOlapEvents() {
        const search = $("olap-search"); if (search) search.addEventListener("input", renderOlapFields);
        const technical = $("olap-show-technical"); if (technical) technical.onchange = () => {
            olapShowTechnical = technical.checked;
            renderOlapFields();
            renderFilterEditor();
        };
        const refresh = $("olap-refresh-fields"); if (refresh) refresh.onclick = async () => {
            try { await loadOlapFields({ force: true, maxAttempts: 3 }); }
            catch (error) { setOlapStatus("🔴 " + error.message); }
        };
        const clear = $("olap-clear"); if (clear) clear.onclick = clearOlap;

        const operator = $("olap-filter-operator"); if (operator) operator.onchange = () => {
            updateFilterInputMode();
            renderFilterSuggestions($("olap-filter-field")?.value || "");
        };
        const filterField = $("olap-filter-field"); if (filterField) filterField.onchange = () => renderFilterSuggestions(filterField.value);
        const addFilter = $("olap-add-filter"); if (addFilter) addFilter.onclick = () => openOlapFilter();
        const applyFilter = $("olap-apply-filter"); if (applyFilter) applyFilter.onclick = () => {
            try { addOlapFilter(); } catch (error) { setOlapStatus("🔴 " + error.message); }
        };
        document.querySelectorAll("[data-close-filter]").forEach(node => node.addEventListener("click", closeOlapFilter));

        const saved = $("olap-saved-reports"); if (saved) saved.onchange = () => loadSavedOlapReport(saved.value);
        const save = $("olap-save-report"); if (save) save.onclick = saveCurrentOlapReport;
        const exportButton = $("olap-export"); if (exportButton) exportButton.onclick = exportOlapCsv;
        const run = $("olap-run"); if (run) run.onclick = runOlap;

        document.addEventListener("click", event => {
            if (selectedFieldMenu && !selectedFieldMenu.contains(event.target)) closeSelectedFieldMenu();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") { closeSelectedFieldMenu(); closeOlapFilter(); }
        });

        renderSavedReports();
        renderOlapFilters();
        bindOlapDropZones();
    }

    async function restoreOlapConnectionAndFields() {
        let restoredFromServer = false;

        try {
            const connection = await refreshIikoConnectionFromServer(false);
            restoredFromServer = Boolean(connection?.ip && connection?.port && connection?.login && connection?.password);
        } catch (error) {
            console.warn("Cannot restore iiko connection from server context", error);
        }

        // Keep legacy localStorage only as a fallback for older accounts/sessions.
        if (!restoredFromServer) loadSavedIikoData();

        if (!iikoConnection) {
            setOlapStatus("🔴 Подключение iiko не найдено. Откройте настройки и переподключите iiko.");
            const container = $("olap-fields");
            if (container) container.innerHTML = `<div class="olap-empty">Подключение iiko не найдено.</div>`;
            return;
        }

        setIikoStatus("🟢 iiko подключение восстановлено");
        try {
            await loadOlapFields({ force: true, maxAttempts: 3 });
            setIikoStatus("🟢 iiko подключён");
        } catch (error) {
            console.warn("Cannot restore OLAP fields", error);
            setIikoStatus("🟡 iiko подключён, но OLAP-поля пока недоступны");
        }
    }

    async function init() {
        if (window.SHAuth) { const user = await window.SHAuth.getUser(); if (!user) return; window.SH_CURRENT_USER = user; }
        createOlapBuilder();
        setDefaultPeriods();

        const connect = $("connect-iiko"); if (connect) connect.onclick = connectIiko;
        const clear = $("clear-iiko-data"); if (clear) clear.onclick = clearSavedIikoData;
        const sales = $("load-sales"); if (sales) sales.onclick = loadSalesReport;

        await restoreOlapConnectionAndFields();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();