// ============================================================
// REPORTS / OLAP
// ============================================================

(() => {
  "use strict";

  // ----------------------------------------------------------
  // GLOBAL STATE
  // ----------------------------------------------------------

  window.olapFields = [];
  window.olapReportType = "SALES";

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setOlapStatus(message) {
    const element = $("#olap-status");

    if (element) {
      element.textContent = message;
    }
  }

  function setOlapCount(count) {
    const element = $("#olap-fields-count");

    if (element) {
      element.textContent = String(count);
    }
  }

  // ----------------------------------------------------------
  // NORMALIZE FIELD
  // ----------------------------------------------------------

  function normalizeOlapField(field, index) {
    if (!field || typeof field !== "object") {
      return {
        id: `field_${index}`,
        name: `Field ${index}`,
        type: "",
        groupingAllowed: false,
        aggregationAllowed: false,
        filteringAllowed: false,
        original: field
      };
    }

    const id =
      field.id ??
      field.fieldName ??
      field.key ??
      field.name ??
      `field_${index}`;

    const name =
      field.name ??
      field.title ??
      field.caption ??
      field.label ??
      field.fieldName ??
      id;

    const type =
      field.type ??
      field.dataType ??
      field.valueType ??
      "";

    return {
      id: String(id),
      name: String(name),
      type: String(type),

      groupingAllowed:
        field.groupingAllowed === true ||
        field.canGroup === true ||
        field.groupable === true,

      aggregationAllowed:
        field.aggregationAllowed === true ||
        field.canAggregate === true ||
        field.aggregateAllowed === true,

      filteringAllowed:
        field.filteringAllowed === true ||
        field.canFilter === true ||
        field.filterable === true,

      original: field
    };
  }

  // ----------------------------------------------------------
  // RENDER FIELDS
  // ----------------------------------------------------------

  function renderOlapFields(fields) {
    const list = $("#olap-fields-list");

    if (!list) {
      console.warn(
        "OLAP: #olap-fields-list not found"
      );

      return;
    }

    list.innerHTML = "";

    if (!fields.length) {
      list.innerHTML = `
        <div class="olap-empty">
          Поля OLAP не найдены
        </div>
      `;

      return;
    }

    fields.forEach((field) => {
      const element = document.createElement("div");

      element.className = "olap-field";

      element.dataset.fieldId = field.id;

      element.innerHTML = `
        <div class="olap-field-name">
          ${escapeHtml(field.name)}
        </div>

        <div class="olap-field-meta">
          ${escapeHtml(field.id)}
        </div>

        ${
          field.type
            ? `
              <div class="olap-field-type">
                ${escapeHtml(field.type)}
              </div>
            `
            : ""
        }
      `;

      list.appendChild(element);
    });
  }

  // ----------------------------------------------------------
  // LOAD OLAP FIELDS
  // ----------------------------------------------------------

  async function loadOlapFields() {
    setOlapStatus("🟡 Загружаю OLAP поля...");
    setOlapCount(0);

    const list = $("#olap-fields-list");

    if (list) {
      list.innerHTML = `
        <div class="olap-loading">
          Загрузка структуры OLAP...
        </div>
      `;
    }

    try {
      const response = await fetch(
        "/api/iiko/olap-columns?reportType=SALES",
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        }
      );

      const data = await response.json();

      console.log(
        "OLAP COLUMNS RESPONSE:",
        data
      );

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `HTTP ${response.status}`
        );
      }

      if (!data || data.ok !== true) {
        throw new Error(
          data?.error ||
          "Не удалось загрузить OLAP поля"
        );
      }

      const rawFields =
        Array.isArray(data.fields)
          ? data.fields
          : [];

      const fields = rawFields.map(
        normalizeOlapField
      );

      window.olapFields = fields;

      setOlapCount(fields.length);

      if (fields.length > 0) {
        setOlapStatus(
          `🟢 Загружено полей: ${fields.length}`
        );
      } else {
        setOlapStatus(
          "🟡 iiko ответил, но поля не найдены"
        );
      }

      renderOlapFields(fields);

      console.log(
        "OLAP NORMALIZED FIELDS:",
        fields
      );

      return fields;

    } catch (error) {
      console.error(
        "OLAP FIELDS ERROR:",
        error
      );

      window.olapFields = [];

      setOlapCount(0);

      setOlapStatus(
        `🔴 Ошибка OLAP: ${error.message}`
      );

      if (list) {
        list.innerHTML = `
          <div class="olap-error">
            <strong>Не удалось загрузить поля OLAP</strong>

            <div class="olap-error-message">
              ${escapeHtml(error.message)}
            </div>
          </div>
        `;
      }

      return [];
    }
  }

  // ----------------------------------------------------------
  // OLAP BUILDER HTML
  // ----------------------------------------------------------

  function createOlapBuilder() {
    const existing = $("#olap-builder");

    if (existing) {
      return;
    }

    const reportsContainer =
      document.querySelector(
        ".reports-container"
      ) ||
      document.querySelector(
        "#reports"
      ) ||
      document.querySelector(
        "main"
      ) ||
      document.body;

    const builder =
      document.createElement("section");

    builder.id = "olap-builder";

    builder.className =
      "olap-builder";

    builder.innerHTML = `
      <div class="olap-builder-header">

        <div>
          <h2>OLAP Конструктор</h2>

          <div class="olap-subtitle">
            Конструктор аналитических отчётов iiko
          </div>
        </div>

        <div
          id="olap-status"
          class="olap-status"
        >
          ⚪ OLAP не загружен
        </div>

      </div>


      <div class="olap-fields-counter">
        Доступных полей:
        <strong id="olap-fields-count">
          0
        </strong>
      </div>


      <div
        id="olap-fields-list"
        class="olap-fields-list"
      >
        <div class="olap-empty">
          OLAP ещё не загружен
        </div>
      </div>

    `;

    reportsContainer.appendChild(builder);
  }

  // ----------------------------------------------------------
  // START
  // ----------------------------------------------------------

  async function initializeOlap() {
    console.log(
      "OLAP: initialize"
    );

    createOlapBuilder();

    await loadOlapFields();
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  window.loadOlapFields =
    loadOlapFields;

  window.initializeOlap =
    initializeOlap;

  // ----------------------------------------------------------
  // DOM READY
  // ----------------------------------------------------------

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initializeOlap();
      }
    );
  } else {
    initializeOlap();
  }

})();
