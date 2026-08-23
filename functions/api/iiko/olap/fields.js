// ============================================================
// IIKO OLAP FIELDS
// Endpoint:
// POST /api/iiko/olap/fields
//
// Получает список полей из:
// /resto/api/v2/reports/olap/columns
// ============================================================


function corsHeaders() {

    return {

        "Access-Control-Allow-Origin": "*",

        "Access-Control-Allow-Methods":
            "POST, OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type"

    };

}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
    data,
    status = 200
) {

    return new Response(

        JSON.stringify(data),

        {

            status,

            headers: {

                "Content-Type":
                    "application/json; charset=utf-8",

                ...corsHeaders()

            }

        }

    );

}


// ============================================================
// SHA1
// ============================================================

async function sha1(text) {

    const data =
        new TextEncoder().encode(text);


    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            data
        );


    return Array
        .from(new Uint8Array(hash))
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");

}


// ============================================================
// GET IIKO TOKEN
// ============================================================

async function getToken(
    ip,
    port,
    login,
    password
) {

    const serverUrl =
        `http://${ip}:${port}`;


    const passwordHash =
        await sha1(password);


    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;


    const response =
        await fetch(
            authUrl,
            {
                method: "GET"
            }
        );


    const token =
        (
            await response.text()
        ).trim();


    if (
        !response.ok ||
        !token
    ) {

        throw new Error(

            `Ошибка авторизации iiko: HTTP ${response.status}`

        );

    }


    return {

        serverUrl,

        token

    };

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
// POST
// ============================================================

export async function onRequestPost(
    context
) {

    try {

        // ----------------------------------------------------
        // READ REQUEST
        // ----------------------------------------------------

        const body =
            await context.request.json();


        // ----------------------------------------------------
        // CONNECTION DATA
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(

                {

                    success: false,

                    message:
                        "Заполните IP, порт, логин и пароль"

                },

                400

            );

        }


        // ----------------------------------------------------
        // REPORT TYPE
        // ----------------------------------------------------

        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        // ----------------------------------------------------
        // AUTH
        // ----------------------------------------------------

        const {
            serverUrl,
            token
        } =
            await getToken(
                ip,
                port,
                login,
                password
            );


        // ----------------------------------------------------
        // IIKO COLUMNS URL
        // ----------------------------------------------------

        const columnsUrl =

            `${serverUrl}` +
            `/resto/api/v2/reports/olap/columns` +
            `?key=${encodeURIComponent(token)}` +
            `&reportType=${encodeURIComponent(reportType)}`;


        // ----------------------------------------------------
        // REQUEST IIKO
        // ----------------------------------------------------

        const response =
            await fetch(

                columnsUrl,

                {

                    method: "GET",

                    headers: {

                        "Accept":
                            "application/json"

                    }

                }

            );


        // ----------------------------------------------------
        // READ RESPONSE
        // ----------------------------------------------------

        const text =
            await response.text();


        // ----------------------------------------------------
        // IIKO ERROR
        // ----------------------------------------------------

        if (!response.ok) {

            return jsonResponse(

                {

                    success: false,

                    message:
                        `Ошибка получения OLAP полей: HTTP ${response.status}`,

                    status:
                        response.status,

                    details:
                        text

                },

                502

            );

        }


        // ----------------------------------------------------
        // PARSE JSON
        // ----------------------------------------------------

        let data;

        try {

            data =
                JSON.parse(text);

        }

        catch (error) {

            return jsonResponse(

                {

                    success: false,

                    message:
                        "iiko вернул не JSON",

                    details:
                        text

                },

                502

            );

        }


        // ====================================================
        // IMPORTANT
        //
        // iiko OLAP columns обычно возвращает:
        //
        // {
        //     "OpenDate.Typed": {
        //         "name": "Учетный день",
        //         "type": "DATE",
        //         "aggregationAllowed": false,
        //         "groupingAllowed": true,
        //         "filteringAllowed": true
        //     },
        //
        //     "DishSumInt": {
        //         "name": "Сумма без скидки",
        //         "type": "MONEY",
        //         "aggregationAllowed": true,
        //         "groupingAllowed": false,
        //         "filteringAllowed": false
        //     }
        // }
        //
        // То есть это НЕ массив.
        //
        // ====================================================


        let fields = [];


        // ----------------------------------------------------
        // CASE 1
        // ARRAY
        // ----------------------------------------------------

        if (
            Array.isArray(data)
        ) {

            fields =
                data.map(
                    (field, index) => {

                        if (
                            typeof field ===
                            "string"
                        ) {

                            return {

                                id:
                                    field,

                                name:
                                    field,

                                title:
                                    field,

                                type:
                                    "UNKNOWN",

                                index

                            };

                        }


                        return {

                            ...field,

                            id:
                                field.id ||
                                field.field ||
                                field.key ||
                                field.name ||
                                `field_${index}`,

                            name:
                                field.name ||
                                field.title ||
                                field.caption ||
                                field.id ||
                                `Field ${index}`,

                            title:
                                field.title ||
                                field.caption ||
                                field.name ||
                                field.id ||
                                `Field ${index}`,

                            index

                        };

                    }
                );

        }


        // ----------------------------------------------------
        // CASE 2
        // { fields: [...] }
        // ----------------------------------------------------

        else if (
            Array.isArray(
                data.fields
            )
        ) {

            fields =
                data.fields.map(
                    (field, index) => {

                        if (
                            typeof field ===
                            "string"
                        ) {

                            return {

                                id:
                                    field,

                                name:
                                    field,

                                title:
                                    field,

                                type:
                                    "UNKNOWN",

                                index

                            };

                        }


                        return {

                            ...field,

                            id:
                                field.id ||
                                field.field ||
                                field.key ||
                                field.name ||
                                `field_${index}`,

                            name:
                                field.name ||
                                field.title ||
                                field.caption ||
                                field.id ||
                                `Field ${index}`,

                            title:
                                field.title ||
                                field.caption ||
                                field.name ||
                                field.id ||
                                `Field ${index}`,

                            index

                        };

                    }
                );

        }


        // ----------------------------------------------------
        // CASE 3
        // { data: [...] }
        // ----------------------------------------------------

        else if (
            Array.isArray(
                data.data
            )
        ) {

            fields =
                data.data.map(
                    (field, index) => {

                        if (
                            typeof field ===
                            "string"
                        ) {

                            return {

                                id:
                                    field,

                                name:
                                    field,

                                title:
                                    field,

                                type:
                                    "UNKNOWN",

                                index

                            };

                        }


                        return {

                            ...field,

                            id:
                                field.id ||
                                field.field ||
                                field.key ||
                                field.name ||
                                `field_${index}`,

                            name:
                                field.name ||
                                field.title ||
                                field.caption ||
                                field.id ||
                                `Field ${index}`,

                            title:
                                field.title ||
                                field.caption ||
                                field.name ||
                                field.id ||
                                `Field ${index}`,

                            index

                        };

                    }
                );

        }


        // ----------------------------------------------------
        // CASE 4
        //
        // REAL IIKO FORMAT
        //
        // {
        //   "OpenDate.Typed": {...},
        //   "DishSumInt": {...}
        // }
        //
        // ----------------------------------------------------

        else if (
            data &&
            typeof data === "object"
        ) {

            fields =
                Object.entries(data)
                    .map(
                        (
                            [
                                fieldId,
                                fieldInfo
                            ],
                            index
                        ) => {

                            // ----------------------------
                            // STRING
                            // ----------------------------

                            if (
                                typeof fieldInfo ===
                                "string"
                            ) {

                                return {

                                    id:
                                        fieldId,

                                    name:
                                        fieldInfo,

                                    title:
                                        fieldInfo,

                                    type:
                                        "UNKNOWN",

                                    index

                                };

                            }


                            // ----------------------------
                            // OBJECT
                            // ----------------------------

                            if (
                                fieldInfo &&
                                typeof fieldInfo ===
                                    "object"
                            ) {

                                return {

                                    ...fieldInfo,

                                    id:
                                        fieldId,

                                    name:
                                        fieldInfo.name ||
                                        fieldInfo.title ||
                                        fieldInfo.caption ||
                                        fieldId,

                                    title:
                                        fieldInfo.title ||
                                        fieldInfo.caption ||
                                        fieldInfo.name ||
                                        fieldId,

                                    type:
                                        fieldInfo.type ||
                                        fieldInfo.dataType ||
                                        "UNKNOWN",

                                    index

                                };

                            }


                            return {

                                id:
                                    fieldId,

                                name:
                                    fieldId,

                                title:
                                    fieldId,

                                type:
                                    "UNKNOWN",

                                index

                            };

                        }
                    );

        }


        // ----------------------------------------------------
        // REMOVE INVALID FIELDS
        // ----------------------------------------------------

        fields =
            fields.filter(
                field =>
                    field &&
                    field.id
            );


        // ----------------------------------------------------
        // SORT
        //
        // Сначала поля, которые можно
        // группировать, затем остальные.
        // ----------------------------------------------------

        fields.sort(
            (a, b) => {

                const aGroup =
                    a.groupingAllowed
                        ? 0
                        : 1;

                const bGroup =
                    b.groupingAllowed
                        ? 0
                        : 1;

                if (
                    aGroup !==
                    bGroup
                ) {

                    return (
                        aGroup -
                        bGroup
                    );

                }


                return String(
                    a.name || a.id
                ).localeCompare(
                    String(
                        b.name || b.id
                    ),
                    "ru"
                );

            }
        );


        // ----------------------------------------------------
        // DEBUG
        // ----------------------------------------------------

        console.log(
            "IIKO OLAP FIELDS COUNT:",
            fields.length
        );


        console.log(
            "IIKO OLAP FIELDS:",
            fields
        );


        // ----------------------------------------------------
        // NO FIELDS
        // ----------------------------------------------------

        if (
            fields.length === 0
        ) {

            return jsonResponse(

                {

                    success: false,

                    message:
                        "iiko вернул ответ, но поля OLAP не найдены",

                    raw:
                        data

                },

                502

            );

        }


        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------

        return jsonResponse(

            {

                success: true,

                reportType,

                count:
                    fields.length,

                fields,

                /*
                 * Оригинальный ответ iiko
                 * оставляем для диагностики.
                 */

                raw:
                    data

            }

        );


    }

    catch (error) {

        console.error(
            "IIKO OLAP FIELDS ERROR:",
            error
        );


        return jsonResponse(

            {

                success: false,

                message:
                    error.message ||
                    "Ошибка получения OLAP полей"

            },

            502

        );

    }

}
