// ============================================================
// ANAR SYSTEM
// IIKO OLAP API
//
// POST /api/iiko/olap
//
// action = "fields"
// action = "query"
// ============================================================

const express = require("express");
const router = express.Router();


// ============================================================
// HELPERS
// ============================================================

function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}


function normalizeBaseUrl(ip, port) {

    ip = clean(ip);
    port = clean(port);

    if (!ip) {
        throw new Error("Не указан IP iiko Server");
    }

    if (!port) {
        throw new Error("Не указан порт iiko Server");
    }

    let host = ip;

    // Если пользователь уже ввёл http://
    // или https://
    if (
        !host.startsWith("http://") &&
        !host.startsWith("https://")
    ) {
        host = "http://" + host;
    }

    // Убираем последний /
    host = host.replace(/\/+$/, "");

    // Если порт уже присутствует
    // в IP/host — повторно не добавляем
    try {

        const parsed = new URL(host);

        if (parsed.port) {
            return host;
        }

    } catch (error) {
        // Ниже будет fallback
    }

    return `${host}:${port}`;
}


// ============================================================
// IIKO REQUEST
// ============================================================

async function iikoRequest(options) {

    const {
        ip,
        port,
        login,
        password,
        method = "GET",
        path,
        body
    } = options;

    const baseUrl =
        normalizeBaseUrl(
            ip,
            port
        );

    // --------------------------------------------------------
    // ВАЖНО:
    //
    // iikoServer REST API использует key.
    //
    // Сначала получаем session key.
    // --------------------------------------------------------

    const loginUrl =
        `${baseUrl}/resto/api/auth`;

    const authParams =
        new URLSearchParams();

    authParams.set(
        "login",
        clean(login)
    );

    authParams.set(
        "pass",
        clean(password)
    );

    const authResponse =
        await fetch(
            loginUrl,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                body:
                    authParams.toString()
            }
        );

    const authText =
        await authResponse.text();

    if (!authResponse.ok) {

        throw new Error(
            `iiko authorization HTTP ${authResponse.status}: ` +
            authText.slice(0, 1000)
        );
    }

    const key =
        clean(authText);

    if (!key) {

        throw new Error(
            "iiko Server не вернул authorization key"
        );
    }

    // --------------------------------------------------------
    // Формируем URL REST API
    // --------------------------------------------------------

    let url =
        `${baseUrl}${path}`;

    const separator =
        url.includes("?")
            ? "&"
            : "?";

    url +=
        `${separator}key=${encodeURIComponent(key)}`;

    // --------------------------------------------------------
    // Request
    // --------------------------------------------------------

    const requestOptions = {

        method,

        headers: {
            "Accept":
                "application/json"
        }
    };

    if (body !== undefined) {

        requestOptions.headers[
            "Content-Type"
        ] = "application/json";

        requestOptions.body =
            JSON.stringify(body);
    }

    const response =
        await fetch(
            url,
            requestOptions
        );

    const text =
        await response.text();

    // --------------------------------------------------------
    // Logout не обязателен, но стараемся закрыть сессию
    // --------------------------------------------------------

    try {

        await fetch(
            `${baseUrl}/resto/api/logout?key=${encodeURIComponent(key)}`,
            {
                method: "GET"
            }
        );

    } catch (logoutError) {

        // logout не должен ломать основной запрос
    }

    if (!response.ok) {

        throw new Error(
            `iiko HTTP ${response.status}: ` +
            text.slice(0, 2000)
        );
    }

    // --------------------------------------------------------
    // Некоторые версии iiko могут вернуть JSON,
    // некоторые endpoint'ы — текст.
    // --------------------------------------------------------

    if (!text) {
        return {};
    }

    try {

        return JSON.parse(text);

    } catch (error) {

        return {
            rawText: text
        };
    }
}


// ============================================================
// NORMALIZE IIKO FIELD
// ============================================================

function normalizeOlapField(
    key,
    value,
    forcedMeasure = false
) {

    // --------------------------------------------------------
    // Если iiko вернул строку
    // --------------------------------------------------------

    if (
        typeof value === "string"
    ) {

        return {

            name:
                key,

            title:
                value,

            type:
                "unknown",

            aggregationAllowed:
                forcedMeasure,

            groupingAllowed:
                !forcedMeasure,

            filteringAllowed:
                true,

            isMeasure:
                forcedMeasure,

            raw:
                value
        };
    }

    // --------------------------------------------------------
    // Если value не объект
    // --------------------------------------------------------

    if (
        !value ||
        typeof value !== "object"
    ) {

        return {

            name:
                key,

            title:
                key,

            type:
                "unknown",

            aggregationAllowed:
                forcedMeasure,

            groupingAllowed:
                !forcedMeasure,

            filteringAllowed:
                true,

            isMeasure:
                forcedMeasure
        };
    }

    const name =
        clean(
            value.name ||
            value.field ||
            value.code ||
            key
        ) || key;

    const title =
        clean(
            value.title ||
            value.caption ||
            value.label ||
            value.displayName ||
            value.name ||
            key
        ) || name;

    const type =
        clean(
            value.type ||
            value.dataType ||
            value.fieldType ||
            value.valueType ||
            value.kind
        );

    const aggregationAllowed =
        value.aggregationAllowed === true ||
        value.allowAggregation === true ||
        value.canAggregate === true;

    const groupingAllowed =
        value.groupingAllowed !== false &&
        value.allowGrouping !== false;

    const filteringAllowed =
        value.filteringAllowed !== false &&
        value.allowFiltering !== false;

    const explicitMeasure =
        value.isMeasure === true ||
        value.measure === true ||
        value.metric === true ||
        value.isMetric === true;

    const isMeasure =
        forcedMeasure ||
        explicitMeasure ||
        aggregationAllowed;

    return {

        ...value,

        name,

        title,

        type,

        aggregationAllowed,

        groupingAllowed,

        filteringAllowed,

        isMeasure
    };
}


// ============================================================
// EXTRACT REAL OLAP COLUMNS
// ============================================================

function extractOlapColumns(raw) {

    const fields = [];

    const seen =
        new Set();

    function add(
        key,
        value,
        forcedMeasure = false
    ) {

        if (
            key === undefined ||
            key === null
        ) {
            return;
        }

        const fieldName =
            clean(key);

        if (!fieldName) {
            return;
        }

        const field =
            normalizeOlapField(
                fieldName,
                value,
                forcedMeasure
            );

        if (!field.name) {
            return;
        }

        if (
            seen.has(field.name)
        ) {

            const existingIndex =
                fields.findIndex(
                    item =>
                        item.name ===
                        field.name
                );

            if (
                existingIndex >= 0
            ) {

                fields[
                    existingIndex
                ] = {

                    ...fields[
                        existingIndex
                    ],

                    ...field,

                    isMeasure:
                        Boolean(
                            fields[
                                existingIndex
                            ].isMeasure ||
                            field.isMeasure
                        )
                };
            }

            return;
        }

        seen.add(
            field.name
        );

        fields.push(
            field
        );
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

        // ----------------------------------------------------
        // Array
        // ----------------------------------------------------

        if (
            Array.isArray(value)
        ) {

            value.forEach(
                item => {

                    if (
                        item &&
                        typeof item ===
                        "object"
                    ) {

                        const key =
                            item.name ||
                            item.field ||
                            item.code ||
                            item.key ||
                            item.id;

                        if (key) {

                            add(
                                key,
                                item,
                                context ===
                                    "measure"
                            );

                        } else {

                            scan(
                                item,
                                context
                            );
                        }

                    } else if (
                        typeof item ===
                        "string"
                    ) {

                        add(
                            item,
                            item,
                            context ===
                                "measure"
                        );
                    }
                }
            );

            return;
        }


        // ----------------------------------------------------
        // Primitive
        // ----------------------------------------------------

        if (
            typeof value !==
            "object"
        ) {
            return;
        }


        // ----------------------------------------------------
        // Standard iiko format:
        //
        // {
        //   "OpenDate.Typed": {
        //      name: "...",
        //      type: "...",
        //      ...
        //   }
        // }
        // ----------------------------------------------------

        Object.entries(value)
            .forEach(
                ([key, child]) => {

                    const lower =
                        key.toLowerCase();

                    // ----------------------------------------
                    // Known containers
                    // ----------------------------------------

                    if (
                        lower ===
                            "columns" ||
                        lower ===
                            "fields" ||
                        lower ===
                            "fielddefinitions" ||
                        lower ===
                            "availablefields"
                    ) {

                        scan(
                            child,
                            "dimension"
                        );

                        return;
                    }


                    if (
                        lower ===
                            "measures" ||
                        lower ===
                            "metrics"
                    ) {

                        scan(
                            child,
                            "measure"
                        );

                        return;
                    }


                    if (
                        lower ===
                            "dimensions"
                    ) {

                        scan(
                            child,
                            "dimension"
                        );

                        return;
                    }


                    // ----------------------------------------
                    // Field object
                    // ----------------------------------------

                    if (
                        child &&
                        typeof child ===
                        "object" &&
                        !Array.isArray(child)
                    ) {

                        const looksLikeField =
                            child.name ||
                            child.type ||
                            child.dataType ||
                            child.aggregationAllowed !==
                                undefined ||
                            child.groupingAllowed !==
                                undefined ||
                            child.filteringAllowed !==
                                undefined;

                        if (
                            looksLikeField
                        ) {

                            add(
                                key,
                                child,
                                context ===
                                    "measure"
                            );

                            return;
                        }
                    }


                    // ----------------------------------------
                    // Recursion
                    // ----------------------------------------

                    if (
                        child &&
                        typeof child ===
                        "object"
                    ) {

                        scan(
                            child,
                            context
                        );
                    }
                }
            );
    }


    scan(
        raw,
        "dimension"
    );


    return fields;
}


// ============================================================
// FALLBACK
//
// ВАЖНО:
// fallback используется только если реальный endpoint
// columns недоступен.
//
// Это НЕ основной список.
// ============================================================

function getFallbackFields() {

    return [

        ["OpenDate.Typed", "Учетный день", "Date"],
        ["OpenTime", "Время открытия", "DateTime"],
        ["CloseTime", "Время закрытия", "DateTime"],

        ["Year", "Год", "Integer"],
        ["Month", "Месяц", "Integer"],
        ["Day", "День", "Integer"],

        ["HourOpen", "Час открытия", "Integer"],
        ["HourClose", "Час закрытия", "Integer"],

        ["Department.Id", "Подразделение", "String"],
        ["Department", "Подразделение", "String"],

        ["Dish.Id", "Блюдо", "String"],
        ["DishName", "Название блюда", "String"],
        ["DishGroup", "Группа блюда", "String"],
        ["DishCategory", "Категория блюда", "String"],
        ["DishCode", "Код блюда", "String"],

        ["WaiterName", "Официант", "String"],

        ["OrderType", "Тип заказа", "String"],
        ["OrderServiceType", "Тип обслуживания", "String"],

        ["PaymentType", "Тип оплаты", "String"],

        ["CustomerCardNumber", "Карта клиента", "String"],

        ["NumGuests", "Количество гостей", "Integer"],

        ["DishAmountInt", "Количество блюд", "Number"],

        ["DishSumInt", "Сумма без скидки", "Number"],

        ["DishDiscountSumInt", "Сумма скидки", "Number"],

        ["DishSumAfterDiscount", "Сумма после скидки", "Number"],

        ["UniqOrderId", "Уникальный заказ", "String"],

        ["OrderNum", "Номер заказа", "String"],

        ["DiscountPercent", "Процент скидки", "Number"],

        ["SurchargePercent", "Процент надбавки", "Number"]
    ].map(
        function (item) {

            const [
                name,
                title,
                type
            ] = item;

            const numeric =
                type === "Number" ||
                type === "Integer";

            return {

                name,

                title,

                type,

                aggregationAllowed:
                    numeric,

                groupingAllowed:
                    true,

                filteringAllowed:
                    true,

                isMeasure:
                    numeric
            };
        }
    );
}


// ============================================================
// GET REAL IIKO OLAP FIELDS
// ============================================================

async function getIikoOlapFields(
    credentials,
    reportType
) {

    const raw =
        await iikoRequest({

            ...credentials,

            method:
                "GET",

            path:
                `/resto/api/v2/reports/olap/columns` +
                `?reportType=${encodeURIComponent(
                    reportType
                )}`
        });


    console.log(
        "========================================"
    );

    console.log(
        "IIKO REAL OLAP COLUMNS RESPONSE"
    );

    console.log(
        JSON.stringify(
            raw,
            null,
            2
        )
    );

    console.log(
        "========================================"
    );


    const fields =
        extractOlapColumns(
            raw
        );


    console.log(
        `IIKO OLAP REAL FIELDS: ${fields.length}`
    );


    return {
        raw,
        fields
    };
}


// ============================================================
// POST /api/iiko/olap
// ============================================================

router.post(
    "/olap",
    async function (req, res) {

        try {

            const body =
                req.body || {};

            const action =
                clean(
                    body.action
                ).toLowerCase();


            // ==================================================
            // CREDENTIALS
            // ==================================================

            const credentials = {

                ip:
                    body.ip,

                port:
                    body.port,

                login:
                    body.login,

                password:
                    body.password
            };


            if (
                !clean(
                    credentials.ip
                ) ||
                !clean(
                    credentials.port
                ) ||
                !clean(
                    credentials.login
                ) ||
                !clean(
                    credentials.password
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Для подключения к iiko нужны IP, порт, логин и пароль."
                });
            }


            // ==================================================
            // FIELDS
            // ==================================================

            if (
                action === "fields"
            ) {

                const reportType =
                    clean(
                        body.reportType
                    ) ||
                    "SALES";


                let result;

                try {

                    result =
                        await getIikoOlapFields(
                            credentials,
                            reportType
                        );

                } catch (error) {

                    console.error(
                        "IIKO OLAP COLUMNS ERROR:",
                        error
                    );

                    const fallback =
                        getFallbackFields();

                    return res.json({

                        success:
                            true,

                        fallback:
                            true,

                        warning:
                            "Не удалось получить структуру OLAP. " +
                            "Доступны стандартные поля iiko.",

                        message:
                            error.message,

                        fields:
                            fallback,

                        data:
                            fallback,

                        count:
                            fallback.length
                    });
                }


                // ----------------------------------------------
                // REAL FIELDS
                // ----------------------------------------------

                if (
                    result.fields.length
                ) {

                    return res.json({

                        success:
                            true,

                        fallback:
                            false,

                        source:
                            "iiko",

                        reportType,

                        count:
                            result.fields.length,

                        fields:
                            result.fields,

                        data:
                            result.fields,

                        columns:
                            result.fields,

                        raw:
                            result.raw
                    });
                }


                // ----------------------------------------------
                // iiko answered but parser found nothing
                // ----------------------------------------------

                console.warn(
                    "iiko returned OLAP columns, " +
                    "but no fields were extracted."
                );


                const fallback =
                    getFallbackFields();


                return res.json({

                    success:
                        true,

                    fallback:
                        true,

                    warning:
                        "iiko ответил, но структура columns не распознана.",

                    fields:
                        fallback,

                    data:
                        fallback,

                    columns:
                        fallback,

                    count:
                        fallback.length,

                    raw:
                        result.raw
                });
            }


            // ==================================================
            // QUERY
            // ==================================================

            if (
                action === "query"
            ) {

                const reportType =
                    clean(
                        body.reportType
                    ) ||
                    "SALES";


                const rows =
                    Array.isArray(
                        body.rows
                    )
                        ? body.rows
                            .map(clean)
                            .filter(Boolean)
                        : [];


                const columns =
                    Array.isArray(
                        body.columns
                    )
                        ? body.columns
                            .map(clean)
                            .filter(Boolean)
                        : [];


                const measures =
                    Array.isArray(
                        body.measures
                    )
                        ? body.measures
                        : [];


                const filters =
                    Array.isArray(
                        body.filters
                    )
                        ? body.filters
                        : [];


                // ----------------------------------------------
                // Даты
                // ----------------------------------------------

                const from =
                    clean(
                        body.from
                    );

                const to =
                    clean(
                        body.to
                    );


                if (
                    !from ||
                    !to
                ) {

                    return res.status(400).json({

                        success:
                            false,

                        message:
                            "Не указан период OLAP."
                    });
                }


                // ----------------------------------------------
                // groupByRowFields
                // ----------------------------------------------

                const groupByRowFields =
                    rows.slice();


                // ----------------------------------------------
                // groupByColumnFields
                // ----------------------------------------------

                const groupByColumnFields =
                    columns.slice();


                // ----------------------------------------------
                // aggregateFields
                //
                // iiko expects field names,
                // not our frontend objects.
                // ----------------------------------------------

                const aggregateFields = [];

                measures.forEach(
                    function (item) {

                        if (
                            typeof item ===
                            "string"
                        ) {

                            const field =
                                clean(item);

                            if (field) {

                                aggregateFields.push(
                                    field
                                );
                            }

                            return;
                        }


                        if (
                            item &&
                            typeof item ===
                            "object"
                        ) {

                            const field =
                                clean(
                                    item.field ||
                                    item.name
                                );

                            if (field) {

                                aggregateFields.push(
                                    field
                                );
                            }
                        }
                    }
                );


                // ----------------------------------------------
                // Filters
                // ----------------------------------------------

                const iikoFilters = {};


                // Всегда добавляем период
                iikoFilters[
                    "OpenDate.Typed"
                ] = {

                    filterType:
                        "DateRange",

                    periodType:
                        "CUSTOM",

                    from:
                        `${from}T00:00:00.000`,

                    to:
                        `${to}T23:59:59.999`
                };


                // ----------------------------------------------
                // Additional filters
                //
                // Текущий frontend передаёт:
                // { field: "..." }
                //
                // Поэтому просто создаём безопасную структуру.
                // ----------------------------------------------

                filters.forEach(
                    function (filter) {

                        if (
                            !filter ||
                            typeof filter !==
                            "object"
                        ) {
                            return;
                        }

                        const field =
                            clean(
                                filter.field ||
                                filter.name
                            );

                        if (!field) {
                            return;
                        }


                        // Если frontend уже передал
                        // настоящий iiko filter
                        if (
                            filter.filterType
                        ) {

                            iikoFilters[field] = {

                                filterType:
                                    filter.filterType,

                                periodType:
                                    filter.periodType,

                                from:
                                    filter.from,

                                to:
                                    filter.to,

                                values:
                                    filter.values
                            };

                            return;
                        }


                        // Пока без значений —
                        // не отправляем пустой фильтр.
                    }
                );


                // ----------------------------------------------
                // iiko OLAP BODY
                // ----------------------------------------------

                const olapBody = {

                    reportType,

                    buildSummary:
                        false,

                    groupByRowFields,

                    groupByColumnFields,

                    aggregateFields,

                    filters:
                        iikoFilters
                };


                console.log(
                    "========================================"
                );

                console.log(
                    "IIKO OLAP QUERY REQUEST"
                );

                console.log(
                    JSON.stringify(
                        olapBody,
                        null,
                        2
                    )
                );

                console.log(
                    "========================================"
                );


                const raw =
                    await iikoRequest({

                        ...credentials,

                        method:
                            "POST",

                        path:
                            "/resto/api/v2/reports/olap",

                        body:
                            olapBody
                    });


                console.log(
                    "========================================"
                );

                console.log(
                    "IIKO OLAP QUERY RESPONSE"
                );

                console.log(
                    JSON.stringify(
                        raw,
                        null,
                        2
                    )
                );

                console.log(
                    "========================================"
                );


                return res.json({

                    success:
                        true,

                    reportType,

                    from,

                    to,

                    request:
                        olapBody,

                    report:
                        raw,

                    data:
                        raw,

                    result:
                        raw
                });
            }


            // ==================================================
            // UNKNOWN ACTION
            // ==================================================

            return res.status(400).json({

                success:
                    false,

                message:
                    "Неизвестный action. Используйте fields или query."
            });

        } catch (error) {

            console.error(
                "========================================"
            );

            console.error(
                "IIKO OLAP BACKEND ERROR"
            );

            console.error(
                error
            );

            console.error(
                "========================================"
            );


            return res.status(500).json({

                success:
                    false,

                message:
                    error.message ||
                    "Ошибка iiko OLAP",

                error:
                    String(error)
            });
        }
    }
);


// ============================================================
// EXPORT
// ============================================================

module.exports =
    router;
