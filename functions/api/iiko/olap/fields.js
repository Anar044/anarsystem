// ==========================================
// IIKO OLAP FIELDS
// GET REAL OLAP FIELDS FROM IIKO SERVER
// ==========================================


// ==========================================
// CORS
// ==========================================

function corsHeaders() {

    return {

        "Access-Control-Allow-Origin": "*",

        "Access-Control-Allow-Methods":
            "POST, OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type"

    };

}


// ==========================================
// JSON RESPONSE
// ==========================================

function jsonResponse(
    data,
    status = 200
) {

    return new Response(

        JSON.stringify(
            data
        ),

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


// ==========================================
// OPTIONS
// ==========================================

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


// ==========================================
// SHA1
// ==========================================

async function sha1(
    text
) {

    const data =
        new TextEncoder()
            .encode(text);


    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            data
        );


    return Array.from(
        new Uint8Array(hash)
    )
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(
                        2,
                        "0"
                    )
        )
        .join("");

}


// ==========================================
// GET IIKO TOKEN
// ==========================================

async function getToken(

    ip,
    port,
    login,
    password

) {

    const serverUrl =
        `http://${ip}:${port}`;


    const passwordHash =
        await sha1(
            password
        );


    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;


    const response =
        await fetch(
            authUrl
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


// ==========================================
// EXTRACT FIELDS
// ==========================================

function extractFields(
    data
) {

    let result = [];


    /*
       Вариант:

       [
         {
           "name": "...",
           "caption": "..."
         }
       ]
    */

    if (
        Array.isArray(data)
    ) {

        result =
            data;

    }


    /*
       Вариант:

       {
           "columns": [...]
       }
    */

    else if (
        data &&
        Array.isArray(
            data.columns
        )
    ) {

        result =
            data.columns;

    }


    /*
       Вариант:

       {
           "fields": [...]
       }
    */

    else if (
        data &&
        Array.isArray(
            data.fields
        )
    ) {

        result =
            data.fields;

    }


    /*
       Вариант:

       {
           "data": [...]
       }
    */

    else if (
        data &&
        Array.isArray(
            data.data
        )
    ) {

        result =
            data.data;

    }


    /*
       Если API вернул объект
       с несколькими группами.
    */

    else if (
        data &&
        typeof data ===
            "object"
    ) {

        Object.keys(
            data
        ).forEach(
            key => {

                if (
                    Array.isArray(
                        data[key]
                    )
                ) {

                    result =
                        result.concat(
                            data[key]
                        );

                }

            }
        );

    }


    /*
       Нормализация.
    */

    return result

        .map(
            (field, index) => {

                /*
                   Если поле строкой.
                */

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

                        isMeasure:
                            false,

                        index

                    };

                }


                /*
                   Если объект.
                */

                const name =

                    field.name ||

                    field.field ||

                    field.key ||

                    field.code ||

                    field.id ||

                    field.column ||

                    field.columnName ||

                    "";


                const title =

                    field.caption ||

                    field.title ||

                    field.label ||

                    field.displayName ||

                    field.name ||

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


                /*
                   Определяем числовые поля.
                */

                const isMeasure =

                    Boolean(

                        field.isMeasure ||

                        field.measure ||

                        field.is_metric ||

                        lowerType.includes(
                            "measure"
                        ) ||

                        lowerType.includes(
                            "number"
                        ) ||

                        lowerType.includes(
                            "numeric"
                        ) ||

                        lowerType.includes(
                            "decimal"
                        ) ||

                        lowerType.includes(
                            "double"
                        ) ||

                        lowerType.includes(
                            "float"
                        ) ||

                        lowerType.includes(
                            "integer"
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
// GET OLAP COLUMNS
// ==========================================

async function getOlapColumns(

    serverUrl,
    token

) {

    /*
       Основной endpoint
       для получения колонок OLAP.
    */

    const url =
        `${serverUrl}/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=SALES`;


    console.log(
        "IIKO OLAP COLUMNS URL:",
        url
    );


    const response =
        await fetch(
            url,
            {
                method:
                    "GET",

                headers: {

                    "Accept":
                        "application/json"

                }

            }
        );


    const text =
        await response.text();


    let data = null;


    try {

        data =
            JSON.parse(
                text
            );

    } catch {

        data =
            null;

    }


    return {

        response,

        text,

        data

    };

}


// ==========================================
// POST
// ==========================================

export async function onRequestPost(
    context
) {

    try {

        const body =
            await context.request.json();


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


        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        /*
           Проверка данных.
        */

        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(

                {

                    success:
                        false,

                    message:
                        "Заполните IP, порт, логин и пароль"

                },

                400

            );

        }


        /*
           Авторизация.
        */

        const {

            serverUrl,

            token

        } = await getToken(

            ip,
            port,
            login,
            password

        );


        /*
           Получаем поля.
        */

        const {

            response,

            text,

            data

        } = await getOlapColumns(

            serverUrl,
            token

        );


        /*
           Если iiko вернул ошибку.
        */

        if (
            !response.ok
        ) {

            return jsonResponse(

                {

                    success:
                        false,

                    iikoHttpStatus:
                        response.status,

                    endpoint:
                        "/resto/api/v2/reports/olap/columns",

                    message:
                        `iiko Server вернул HTTP ${response.status}`,

                    rawResponse:
                        text.substring(
                            0,
                            30000
                        )

                },

                502

            );

        }


        /*
           Извлекаем поля.
        */

        const fields =
            extractFields(
                data
            );


        /*
           Возвращаем результат
           frontend.
        */

        return jsonResponse(

            {

                success:
                    true,

                iikoHttpStatus:
                    response.status,

                endpoint:
                    "/resto/api/v2/reports/olap/columns",

                reportType,

                count:
                    fields.length,

                fields,

                rawResponse:
                    text.substring(
                        0,
                        30000
                    )

            },

            200

        );


    } catch (error) {

        console.error(
            "IIKO OLAP FIELDS ERROR:",
            error
        );


        return jsonResponse(

            {

                success:
                    false,

                message:
                    error.message ||
                    "Ошибка получения полей OLAP"

            },

            502

        );

    }

}
