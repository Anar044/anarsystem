// ============================================================
// ANAR SYSTEM
// IIKO OLAP API
// functions/api/iiko/olap.js
//
// Полная версия с автоматическим сопоставлением:
//
//     "Касса"
//         ↓
//     поле iiko из /columns
//
//     "Сумма со скидкой"
//         ↓
//     поле iiko из /columns
//
// Благодаря этому frontend может работать с красивыми
// названиями полей, а iiko получает технические ID.
// ============================================================


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(data, status = 200, requestId = null) {

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders()
    };

    if (requestId) {
        headers["X-OLAP-Request-ID"] = requestId;
    }

    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers
        }
    );
}


// ============================================================
// REQUEST ID
// ============================================================

function createRequestId() {

    try {

        if (
            typeof crypto !== "undefined" &&
            crypto.randomUUID
        ) {
            return crypto.randomUUID();
        }

    } catch (error) {
        // ignore
    }

    return (
        Date.now().toString(36) +
        "-" +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}


// ============================================================
// LOG
// ============================================================

function logInfo(requestId, message, data = null) {

    if (data === null) {

        console.log(
            `[OLAP][${requestId}] ${message}`
        );

        return;
    }

    console.log(
        `[OLAP][${requestId}] ${message}`,
        data
    );
}


function logError(requestId, message, data = null) {

    if (data === null) {

        console.error(
            `[OLAP][${requestId}] ${message}`
        );

        return;
    }

    console.error(
        `[OLAP][${requestId}] ${message}`,
        data
    );
}


// ============================================================
// SAFE CONNECTION INFO
// ============================================================

function safeConnectionInfo({
    ip,
    port,
    login
}) {

    return {
        ip,
        port,
        login,

        serverUrl:
            `http://${ip}:${port}`
    };
}


// ============================================================
// SHA1
// ============================================================

async function sha1(text) {

    const bytes =
        new TextEncoder().encode(text);

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            bytes
        );

    return Array
        .from(
            new Uint8Array(hash)
        )
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");
}


// ============================================================
// IIKO AUTH
// ============================================================

async function getToken(
    ip,
    port,
    login,
    password,
    requestId
) {

    logInfo(
        requestId,
        "AUTH START",
        {
            ip,
            port,
            login
        }
    );


    if (
        !ip ||
        !port ||
        !login ||
        !password
    ) {

        throw new Error(
            "Необходимо указать IP, порт, логин и пароль iiko"
        );
    }


    const serverUrl =
        `http://${ip}:${port}`;


    const passwordHash =
        await sha1(password);


    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;


    let response;


    try {

        response =
            await fetch(
                authUrl,
                {
                    method: "GET"
                }
            );

    } catch (error) {

        logError(
            requestId,
            "AUTH FETCH ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );

        throw error;
    }


    const text =
        (
            await response.text()
        ).trim();


    logInfo(
        requestId,
        "AUTH RESPONSE",
        {
            httpStatus:
                response.status,

            ok:
                response.ok,

            bodyLength:
                text.length
        }
    );


    if (
        !response.ok ||
        !text
    ) {

        logError(
            requestId,
            "AUTH FAILED",
            {
                httpStatus:
                    response.status,

                responseBody:
                    text.slice(0, 5000)
            }
        );


        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }


    logInfo(
        requestId,
        "AUTH SUCCESS"
    );


    return {
        serverUrl,
        token: text
    };
}


// ============================================================
// DATE
// ============================================================

function normalizeDate(value, end = false) {

    if (!value) {
        return "";
    }

    const date =
        String(value).slice(0, 10);

    return (
        date +
        (
            end
                ? "T23:59:59.999"
                : "T00:00:00.000"
        )
    );
}


// ============================================================
// NORMALIZE COLUMNS
//
// iiko может вернуть:
//
// [
//   {...},
//   {...}
// ]
//
// или:
//
// {
//   columns: [...]
// }
//
// или:
//
// {
//   fields: [...]
// }
//
// Поэтому здесь делаем максимально устойчивый разбор.
// ============================================================

function normalizeColumns(raw) {

    if (Array.isArray(raw)) {
        return raw;
    }


    if (
        raw &&
        typeof raw === "object"
    ) {

        if (
            Array.isArray(raw.columns)
        ) {
            return raw.columns;
        }


        if (
            Array.isArray(raw.fields)
        ) {
            return raw.fields;
        }


        if (
            Array.isArray(raw.data)
        ) {
            return raw.data;
        }


        if (
            Array.isArray(raw.items)
        ) {
            return raw.items;
        }


        if (
            Array.isArray(raw.result)
        ) {
            return raw.result;
        }


        return Object
            .entries(raw)
            .map(
                ([key, value]) => {

                    if (
                        value &&
                        typeof value === "object"
                    ) {

                        return {
                            ...value,

                            id:
                                value.id ||
                                value.name ||
                                key,

                            name:
                                value.name ||
                                value.id ||
                                key,

                            title:
                                value.title ||
                                value.caption ||
                                value.name ||
                                key
                        };
                    }


                    return {
                        id: key,
                        name: key,
                        title: key
                    };
                }
            );
    }


    return [];
}


// ============================================================
// GET FIELD ID
//
// У разных версий iiko структура columns может отличаться.
// Поэтому проверяем много возможных свойств.
// ============================================================

function getFieldId(field) {

    if (
        field === null ||
        field === undefined
    ) {
        return "";
    }


    if (
        typeof field === "string"
    ) {
        return field.trim();
    }


    if (
        typeof field !== "object"
    ) {
        return "";
    }


    const candidates = [

        field.id,

        field.field,

        field.fieldName,

        field.name,

        field.key,

        field.code,

        field.columnName,

        field.identifier,

        field.uniqueName,

        field.path,

        field.value

    ];


    for (
        const candidate of candidates
    ) {

        if (
            typeof candidate === "string" &&
            candidate.trim()
        ) {

            return candidate.trim();
        }
    }


    return "";
}


// ============================================================
// GET FIELD TITLE
//
// Это красивое имя, которое видит пользователь.
// ============================================================

function getFieldTitle(field) {

    if (
        field === null ||
        field === undefined
    ) {
        return "";
    }


    if (
        typeof field === "string"
    ) {
        return field.trim();
    }


    if (
        typeof field !== "object"
    ) {
        return "";
    }


    const candidates = [

        field.title,

        field.caption,

        field.displayName,

        field.label,

        field.description,

        field.name,

        field.fieldName,

        field.id

    ];


    for (
        const candidate of candidates
    ) {

        if (
            typeof candidate === "string" &&
            candidate.trim()
        ) {

            return candidate.trim();
        }
    }


    return "";
}


// ============================================================
// NORMALIZE TEXT
//
// Используем для поиска:
// "Касса"
// " касса "
// "КАССА"
//
// будут считаться одним названием.
// ============================================================

function normalizeText(value) {

    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}


// ============================================================
// FIELD ALIASES
//
// Некоторые поля iiko могут называться немного иначе.
// Здесь можно постепенно добавлять алиасы.
//
// Важно:
// сначала используется реальный /columns,
// а aliases являются запасным механизмом.
// ============================================================

const FIELD_ALIASES = {

    "касса": [
        "Касса",
        "CashRegister",
        "CashRegisterName",
        "CashRegister.Code",
        "CashRegister.Name"
    ],

    "сумма со скидкой": [
        "Сумма со скидкой",
        "DishDiscountSumInt",
        "DishDiscountSum",
        "DiscountSum",
        "DishSumInt"
    ],

    "сумма": [
        "Сумма",
        "DishSumInt",
        "OrderSum",
        "OrderSumInt"
    ],

    "блюдо": [
        "Блюдо",
        "DishName",
        "Dish"
    ],

    "категория блюда": [
        "Категория блюда",
        "DishCategory",
        "DishCategory.Name",
        "DishCategoryName"
    ],

    "группа блюда": [
        "Группа блюда",
        "DishGroup",
        "DishGroup.Name",
        "DishGroupName"
    ],

    "официант": [
        "Официант",
        "Waiter",
        "Waiter.Name",
        "WaiterName"
    ],

    "организация": [
        "Организация",
        "Department",
        "Department.Name",
        "Organization"
    ],

    "номер заказа": [
        "Номер заказа",
        "OrderNumber",
        "OrderNum",
        "UniqOrderId"
    ],

    "дата": [
        "Дата",
        "OpenDate",
        "OpenDate.Typed"
    ],

    "время": [
        "Время",
        "OpenTime",
        "OpenDate.Typed"
    ]
};


// ============================================================
// FIND FIELD
//
// Главное место новой логики.
//
// Получаем:
//     "Касса"
//
// и пытаемся найти:
//     "CashRegister"
//     или реальный ID из /columns.
// ============================================================

function findField(
    requested,
    columns
) {

    if (
        !requested
    ) {
        return null;
    }


    const requestedText =
        String(requested).trim();


    if (
        !requestedText
    ) {
        return null;
    }


    const normalizedRequested =
        normalizeText(
            requestedText
        );


    // ========================================================
    // 1. Точное совпадение ID
    // ========================================================

    for (
        const field of columns
    ) {

        const id =
            getFieldId(field);


        if (
            normalizeText(id) ===
            normalizedRequested
        ) {

            return {
                requested:
                    requestedText,

                resolved:
                    id,

                title:
                    getFieldTitle(field),

                source:
                    "id-exact"
            };
        }
    }


    // ========================================================
    // 2. Точное совпадение title/name
    // ========================================================

    for (
        const field of columns
    ) {

        const title =
            getFieldTitle(field);


        if (
            normalizeText(title) ===
            normalizedRequested
        ) {

            const id =
                getFieldId(field);


            if (id) {

                return {
                    requested:
                        requestedText,

                    resolved:
                        id,

                    title,

                    source:
                        "title-exact"
                };
            }
        }
    }


    // ========================================================
    // 3. Совпадение по aliases
    // ========================================================

    const aliases =
        FIELD_ALIASES[
            normalizedRequested
        ] || [];


    for (
        const alias of aliases
    ) {

        const normalizedAlias =
            normalizeText(alias);


        // Сначала ID

        for (
            const field of columns
        ) {

            const id =
                getFieldId(field);


            if (
                normalizeText(id) ===
                normalizedAlias
            ) {

                return {
                    requested:
                        requestedText,

                    resolved:
                        id,

                    title:
                        getFieldTitle(field),

                    source:
                        "alias-id"
                };
            }
        }


        // Затем title

        for (
            const field of columns
        ) {

            const title =
                getFieldTitle(field);


            if (
                normalizeText(title) ===
                normalizedAlias
            ) {

                const id =
                    getFieldId(field);


                if (id) {

                    return {
                        requested:
                            requestedText,

                        resolved:
                            id,

                        title,

                        source:
                            "alias-title"
                    };
                }
            }
        }
    }


    // ========================================================
    // 4. Частичное совпадение
    //
    // Например:
    // "Касса" ↔ "Касса продажи"
    // ========================================================

    for (
        const field of columns
    ) {

        const title =
            normalizeText(
                getFieldTitle(field)
            );


        const id =
            normalizeText(
                getFieldId(field)
            );


        if (
            title &&
            (
                title.includes(
                    normalizedRequested
                ) ||
                normalizedRequested.includes(
                    title
                )
            )
        ) {

            const resolved =
                getFieldId(field);


            if (resolved) {

                return {
                    requested:
                        requestedText,

                    resolved,

                    title:
                        getFieldTitle(field),

                    source:
                        "title-partial"
                };
            }
        }


        if (
            id &&
            (
                id.includes(
                    normalizedRequested
                ) ||
                normalizedRequested.includes(
                    id
                )
            )
        ) {

            const resolved =
                getFieldId(field);


            if (resolved) {

                return {
                    requested:
                        requestedText,

                    resolved,

                    title:
                        getFieldTitle(field),

                    source:
                        "id-partial"
                };
            }
        }
    }


    return null;
}


// ============================================================
// RESOLVE FIELD LIST
// ============================================================

function resolveFieldList(
    requestedFields,
    columns,
    requestId,
    fieldType
) {

    const resolved = [];
    const unresolved = [];
    const mapping = [];


    for (
        const requested of requestedFields
    ) {

        const result =
            findField(
                requested,
                columns
            );


        if (
            result &&
            result.resolved
        ) {

            resolved.push(
                result.resolved
            );


            mapping.push({
                type:
                    fieldType,

                requested:
                    result.requested,

                resolved:
                    result.resolved,

                title:
                    result.title,

                source:
                    result.source
            });

        } else {

            unresolved.push(
                String(requested)
            );


            mapping.push({
                type:
                    fieldType,

                requested:
                    String(requested),

                resolved:
                    null,

                source:
                    "NOT_FOUND"
            });
        }
    }


    logInfo(
        requestId,
        `FIELD RESOLUTION: ${fieldType}`,
        {
            requested:
                requestedFields,

            resolved,

            unresolved
        }
    );


    return {
        resolved,
        unresolved,
        mapping
    };
}


// ============================================================
// FETCH IIKO COLUMNS
//
// Используется сервером автоматически перед построением
// отчёта.
// ============================================================

async function fetchColumns({
    serverUrl,
    token,
    reportType,
    requestId
}) {

    const endpoint =
        `${serverUrl}` +
        `/resto/api/v2/reports/olap/columns`;


    const url =
        endpoint +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=${encodeURIComponent(reportType)}`;


    logInfo(
        requestId,
        "IIKO COLUMNS REQUEST",
        {
            endpoint,
            reportType
        }
    );


    let response;


    try {

        response =
            await fetch(
                url,
                {
                    method: "GET"
                }
            );

    } catch (error) {

        logError(
            requestId,
            "IIKO COLUMNS FETCH ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );

        throw error;
    }


    const text =
        await response.text();


    logInfo(
        requestId,
        "IIKO COLUMNS RESPONSE",
        {
            httpStatus:
                response.status,

            ok:
                response.ok,

            bodyLength:
                text.length
        }
    );


    if (
        !response.ok
    ) {

        logError(
            requestId,
            "IIKO COLUMNS HTTP ERROR",
            {
                httpStatus:
                    response.status,

                responseBody:
                    text.slice(
                        0,
                        30000
                    )
            }
        );


        throw new Error(
            `Не удалось получить поля iiko: HTTP ${response.status}. ${text.slice(0, 1000)}`
        );
    }


    let raw;


    try {

        raw =
            JSON.parse(text);

    } catch (error) {

        logError(
            requestId,
            "IIKO COLUMNS INVALID JSON",
            {
                response:
                    text.slice(
                        0,
                        10000
                    )
            }
        );


        throw new Error(
            "iiko вернул некорректный JSON со списком OLAP-полей"
        );
    }


    const columns =
        normalizeColumns(raw);


    logInfo(
        requestId,
        "IIKO COLUMNS NORMALIZED",
        {
            count:
                columns.length
        }
    );


    return {
        columns,
        raw
    };
}


// ============================================================
// GET FIELDS
// ============================================================

async function getFields({
    ip,
    port,
    login,
    password,
    reportType = "SALES",
    requestId
}) {

    logInfo(
        requestId,
        "GET FIELDS START",
        {
            reportType,

            connection:
                safeConnectionInfo({
                    ip,
                    port,
                    login
                })
        }
    );


    const {
        serverUrl,
        token
    } =
        await getToken(
            ip,
            port,
            login,
            password,
            requestId
        );


    const {
        columns,
        raw
    } =
        await fetchColumns({
            serverUrl,
            token,
            reportType,
            requestId
        });


    const fields =
        columns.map(
            field => {

                const id =
                    getFieldId(field);

                const title =
                    getFieldTitle(field);


                return {
                    ...field,

                    id,

                    name:
                        field.name ||
                        title ||
                        id,

                    title:
                        title ||
                        id
                };
            }
        );


    logInfo(
        requestId,
        "FIELDS READY",
        {
            count:
                fields.length,

            preview:
                fields
                    .slice(0, 50)
                    .map(
                        field => ({
                            id:
                                field.id,

                            name:
                                field.name,

                            title:
                                field.title
                        })
                    )
        }
    );


    return jsonResponse(
        {
            success: true,

            requestId,

            reportType,

            count:
                fields.length,

            fields,

            // Оставляем raw для диагностики.
            // Frontend может его игнорировать.
            raw
        },
        200,
        requestId
    );
}


// ============================================================
// OPTIONS
// ============================================================

export async function onRequestOptions() {

    return new Response(
        null,
        {
            status: 204,
            headers:
                corsHeaders()
        }
    );
}


// ============================================================
// GET
// ============================================================

export async function onRequestGet(
    context
) {

    const requestId =
        createRequestId();


    try {

        const url =
            new URL(
                context.request.url
            );


        const mode =
            (
                url.searchParams.get(
                    "mode"
                ) || "fields"
            ).trim();


        const reportType =
            (
                url.searchParams.get(
                    "reportType"
                ) || "SALES"
            )
                .trim()
                .toUpperCase();


        const ip =
            (
                url.searchParams.get(
                    "ip"
                ) || ""
            ).trim();


        const port =
            (
                url.searchParams.get(
                    "port"
                ) || ""
            ).trim();


        const login =
            (
                url.searchParams.get(
                    "login"
                ) || ""
            ).trim();


        const password =
            url.searchParams.get(
                "password"
            ) || "";


        logInfo(
            requestId,
            "GET",
            {
                mode,
                reportType,
                hasIp:
                    Boolean(ip),
                hasPort:
                    Boolean(port),
                hasLogin:
                    Boolean(login),
                hasPassword:
                    Boolean(password)
            }
        );


        if (
            mode !== "fields"
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Неизвестный режим"
                },
                400,
                requestId
            );
        }


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Нужны IP, порт, логин и пароль iiko"
                },
                400,
                requestId
            );
        }


        return await getFields({
            ip,
            port,
            login,
            password,
            reportType,
            requestId
        });

    } catch (error) {

        logError(
            requestId,
            "GET ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                message:
                    error?.message ||
                    "Ошибка OLAP"
            },
            502,
            requestId
        );
    }
}


// ============================================================
// POST
// ============================================================

export async function onRequestPost(
    context
) {

    const requestId =
        createRequestId();


    logInfo(
        requestId,
        "POST START"
    );


    try {

        const body =
            await context.request.json();


        // ======================================================
        // CONNECTION
        // ======================================================

        const ip =
            String(
                body.ip || ""
            ).trim();


        const port =
            String(
                body.port || ""
            ).trim();


        const login =
            String(
                body.login || ""
            ).trim();


        const password =
            String(
                body.password || ""
            );


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Заполните IP, порт, логин и пароль iiko"
                },
                400,
                requestId
            );
        }


        // ======================================================
        // REPORT TYPE
        // ======================================================

        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        // ======================================================
        // ACTION FIELDS
        // ======================================================

        if (
            body.action === "fields"
        ) {

            return await getFields({
                ip,
                port,
                login,
                password,
                reportType,
                requestId
            });
        }


        // ======================================================
        // ROWS
        // ======================================================

        let groupByRowFields = [];


        if (
            Array.isArray(
                body.groupByRowFields
            )
        ) {

            groupByRowFields =
                body.groupByRowFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.rows
            )
        ) {

            groupByRowFields =
                body.rows
                    .filter(Boolean)
                    .map(String);
        }


        // ======================================================
        // COLUMNS
        // ======================================================

        let groupByColFields = [];


        if (
            Array.isArray(
                body.groupByColFields
            )
        ) {

            groupByColFields =
                body.groupByColFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.groupByColumnFields
            )
        ) {

            groupByColFields =
                body.groupByColumnFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.columns
            )
        ) {

            groupByColFields =
                body.columns
                    .filter(Boolean)
                    .map(String);
        }


        // ======================================================
        // MEASURES
        // ======================================================

        let aggregateFields = [];


        const measureSource =
            Array.isArray(
                body.aggregateFields
            )
                ? body.aggregateFields
                : (
                    Array.isArray(
                        body.measures
                    )
                        ? body.measures
                        : []
                );


        aggregateFields =
            measureSource
                .map(
                    item => {

                        if (
                            typeof item ===
                            "string"
                        ) {
                            return item;
                        }


                        if (
                            item &&
                            typeof item ===
                            "object"
                        ) {

                            return (
                                item.field ||
                                item.name ||
                                item.id ||
                                item.title ||
                                ""
                            );
                        }


                        return "";
                    }
                )
                .filter(Boolean);


        // ======================================================
        // LOG FRONTEND DATA
        // ======================================================

        logInfo(
            requestId,
            "FRONTEND OLAP FIELDS",
            {
                reportType,

                rows:
                    groupByRowFields,

                columns:
                    groupByColFields,

                measures:
                    aggregateFields
            }
        );


        // ======================================================
        // BASIC VALIDATION
        // ======================================================

        if (
            !groupByRowFields.length &&
            !groupByColFields.length &&
            !aggregateFields.length
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Перетащите хотя бы одно поле в конструктор"
                },
                400,
                requestId
            );
        }


        // ======================================================
        // AUTH
        // ======================================================

        const {
            serverUrl,
            token
        } =
            await getToken(
                ip,
                port,
                login,
                password,
                requestId
            );


        // ======================================================
        // GET REAL IIKO FIELDS
        //
        // Вот здесь происходит главное исправление.
        // ======================================================

        const {
            columns
        } =
            await fetchColumns({
                serverUrl,
                token,
                reportType,
                requestId
            });


        if (
            !columns.length
        ) {

            logError(
                requestId,
                "NO IIKO COLUMNS"
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "iiko не вернул OLAP-поля",

                    iikoHttpStatus:
                        200,

                    fields:
                        []
                },
                502,
                requestId
            );
        }


        // ======================================================
        // RESOLVE ROWS
        // ======================================================

        const resolvedRows =
            resolveFieldList(
                groupByRowFields,
                columns,
                requestId,
                "row"
            );


        // ======================================================
        // RESOLVE COLUMNS
        // ======================================================

        const resolvedColumns =
            resolveFieldList(
                groupByColFields,
                columns,
                requestId,
                "column"
            );


        // ======================================================
        // RESOLVE MEASURES
        // ======================================================

        const resolvedMeasures =
            resolveFieldList(
                aggregateFields,
                columns,
                requestId,
                "measure"
            );


        // ======================================================
        // CHECK UNRESOLVED
        // ======================================================

        const unresolved = [
            ...resolvedRows.unresolved,
            ...resolvedColumns.unresolved,
            ...resolvedMeasures.unresolved
        ];


        if (
            unresolved.length
        ) {

            logError(
                requestId,
                "FIELD RESOLUTION FAILED",
                {
                    unresolved,

                    mapping: [
                        ...resolvedRows.mapping,
                        ...resolvedColumns.mapping,
                        ...resolvedMeasures.mapping
                    ]
                }
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Не удалось сопоставить некоторые OLAP-поля iiko",

                    unresolved,

                    mapping: [
                        ...resolvedRows.mapping,
                        ...resolvedColumns.mapping,
                        ...resolvedMeasures.mapping
                    ],

                    availableFields:
                        columns
                            .map(
                                field => ({
                                    id:
                                        getFieldId(field),

                                    title:
                                        getFieldTitle(field)
                                })
                            )
                            .filter(
                                field =>
                                    field.id ||
                                    field.title
                            )
                            .slice(
                                0,
                                500
                            )
                },
                400,
                requestId
            );
        }


        // ======================================================
        // FILTERS
        // ======================================================

        let filters = {};


        if (
            body.filters &&
            typeof body.filters === "object" &&
            !Array.isArray(body.filters)
        ) {

            filters = {
                ...body.filters
            };
        }


        // ======================================================
        // PERIOD
        // ======================================================

        if (
            body.from ||
            body.to
        ) {

            const from =
                normalizeDate(
                    body.from
                );


            const to =
                normalizeDate(
                    body.to,
                    true
                );


            filters[
                "OpenDate.Typed"
            ] = {

                filterType:
                    "DateRange",

                periodType:
                    "CUSTOM",

                from,

                to,

                includeLow:
                    true,

                includeHigh:
                    true
            };
        }


        // ======================================================
        // REAL IIKO REQUEST
        //
        // Здесь уже НЕТ:
        //
        // "Касса"
        //
        // Здесь будет реальный ID из /columns.
        // ======================================================

        const requestBody = {

            reportType,

            buildSummary:
                body.buildSummary !== false,

            groupByRowFields:
                resolvedRows.resolved,

            groupByColFields:
                resolvedColumns.resolved,

            aggregateFields:
                resolvedMeasures.resolved,

            filters
        };


        // ======================================================
        // DEBUG MAPPING
        // ======================================================

        logInfo(
            requestId,
            "FIELD MAPPING",
            {
                rows:
                    resolvedRows.mapping,

                columns:
                    resolvedColumns.mapping,

                measures:
                    resolvedMeasures.mapping
            }
        );


        // ======================================================
        // DEBUG FINAL REQUEST
        // ======================================================

        logInfo(
            requestId,
            "FINAL IIKO OLAP REQUEST BODY",
            JSON.stringify(
                requestBody,
                null,
                2
            )
        );


        // ======================================================
        // IIKO OLAP REQUEST
        // ======================================================

        const endpoint =
            `${serverUrl}` +
            `/resto/api/v2/reports/olap`;


        const url =
            endpoint +
            `?key=${encodeURIComponent(token)}`;


        let response;


        try {

            response =
                await fetch(
                    url,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                requestBody
                            )
                    }
                );

        } catch (error) {

            logError(
                requestId,
                "IIKO OLAP FETCH ERROR",
                {
                    name:
                        error?.name,

                    message:
                        error?.message,

                    stack:
                        error?.stack
                }
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        error?.message ||
                        "Ошибка соединения с iiko",

                    request:
                        requestBody
                },
                502,
                requestId
            );
        }


        // ======================================================
        // READ RESPONSE
        // ======================================================

        const text =
            await response.text();


        let report = null;


        try {

            report =
                JSON.parse(text);

        } catch (error) {

            report = null;
        }


        // ======================================================
        // IIKO SUCCESS
        // ======================================================

        if (
            response.ok
        ) {

            logInfo(
                requestId,
                "IIKO OLAP SUCCESS",
                {
                    httpStatus:
                        response.status,

                    responseLength:
                        text.length
                }
            );


            return jsonResponse(
                {
                    success: true,

                    requestId,

                    iikoHttpStatus:
                        response.status,

                    endpoint:
                        "/resto/api/v2/reports/olap",

                    request:
                        requestBody,

                    mapping: {
                        rows:
                            resolvedRows.mapping,

                        columns:
                            resolvedColumns.mapping,

                        measures:
                            resolvedMeasures.mapping
                    },

                    report,

                    rawResponse:
                        text.slice(
                            0,
                            30000
                        )
                },
                200,
                requestId
            );
        }


        // ======================================================
        // IIKO ERROR
        // ======================================================

        logError(
            requestId,
            "IIKO OLAP HTTP ERROR",
            {
                httpStatus:
                    response.status,

                statusText:
                    response.statusText,

                responseBody:
                    text.slice(
                        0,
                        30000
                    )
            }
        );


        logError(
            requestId,
            "FAILED REQUEST BODY",
            JSON.stringify(
                requestBody,
                null,
                2
            )
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                iikoHttpStatus:
                    response.status,

                iikoStatusText:
                    response.statusText,

                endpoint:
                    "/resto/api/v2/reports/olap",

                message:
                    `iiko OLAP вернул HTTP ${response.status}`,

                request:
                    requestBody,

                mapping: {
                    rows:
                        resolvedRows.mapping,

                    columns:
                        resolvedColumns.mapping,

                    measures:
                        resolvedMeasures.mapping
                },

                rawResponse:
                    text.slice(
                        0,
                        30000
                    ),

                report
            },
            502,
            requestId
        );


    } catch (error) {

        logError(
            requestId,
            "POST UNHANDLED ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message,

                stack:
                    error?.stack
            }
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                message:
                    error?.message ||
                    "Ошибка OLAP"
            },
            502,
            requestId
        );
    }
}
