// ============================================================
// IIKO OLAP FIELDS
// /api/iiko/olap/fields
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
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
        new TextEncoder()
            .encode(text);

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            data
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
        // BODY
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
        // IIKO OLAP COLUMNS URL
        // ----------------------------------------------------

        const columnsUrl =
            `${serverUrl}` +
            `/resto/api/v2/reports/olap/columns` +
            `?key=${encodeURIComponent(token)}` +
            `&reportType=${encodeURIComponent(reportType)}`;


        console.log(
            "IIKO OLAP COLUMNS:",
            columnsUrl
                .replace(
                    token,
                    "***"
                )
        );


        // ----------------------------------------------------
        // REQUEST
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
        // RESPONSE TEXT
        // ----------------------------------------------------

        const text =
            await response.text();


        console.log(
            "IIKO OLAP COLUMNS STATUS:",
            response.status
        );


        // ----------------------------------------------------
        // ERROR
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

        } catch (error) {

            return jsonResponse(
                {
                    success: false,

                    message:
                        "iiko вернул некорректный JSON",

                    details:
                        text
                },

                502
            );
        }


        // ----------------------------------------------------
        // EXTRACT FIELDS
        // ----------------------------------------------------

        let fields = [];


        /*
         * В разных версиях iiko
         * структура ответа может немного
         * отличаться.
         *
         * Поддерживаем основные варианты.
         */


        if (
            Array.isArray(data)
        ) {

            fields =
                data;

        } else if (
            Array.isArray(
                data.fields
            )
        ) {

            fields =
                data.fields;

        } else if (
            Array.isArray(
                data.columns
            )
        ) {

            fields =
                data.columns;

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

            /*
             * Иногда fields может быть
             * объектом.
             */

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


        // ----------------------------------------------------
        // NORMALIZE FIELDS
        // ----------------------------------------------------

        const normalizedFields =
            fields
                .map(
                    (field, index) => {

                        // ------------------------------------
                        // STRING
                        // ------------------------------------

                        if (
                            typeof field ===
                            "string"
                        ) {

                            return {
                                name:
                                    field,

                                title:
                                    field,

                                type:
                                    "unknown",

                                index
                            };
                        }


                        // ------------------------------------
                        // OBJECT
                        // ------------------------------------

                        if (
                            !field ||
                            typeof field !==
                                "object"
                        ) {

                            return null;
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
                            field.description ||
                            name;


                        const type =
                            String(
                                field.type ||
                                field.dataType ||
                                field.kind ||
                                ""
                            );


                        return {

                            ...field,

                            name:
                                String(
                                    name
                                ),

                            title:
                                String(
                                    title
                                ),

                            type,

                            index
                        };
                    }
                )
                .filter(
                    field =>
                        field &&
                        field.name
                );


        // ----------------------------------------------------
        // RESPONSE
        // ----------------------------------------------------

        return jsonResponse(
            {
                success: true,

                reportType,

                count:
                    normalizedFields.length,

                fields:
                    normalizedFields,

                /*
                 * Оставляем оригинальный
                 * ответ iiko для диагностики.
                 */

                raw:
                    data
            }
        );


    } catch (error) {

        console.error(
            "IIKO OLAP FIELDS ERROR:",
            error
        );


        return jsonResponse(
            {
                success: false,

                message:
                    error.message ||
                    "Неизвестная ошибка OLAP fields"
            },

            502
        );
    }
}
