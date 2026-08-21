// ==========================================
// IIKO REPORTS
// ==========================================

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


let iikoConnection = null;


// ==========================================
// STORAGE
// ==========================================

const IIKO_STORAGE_KEY =
    "iikoConnection";


// ==========================================
// LOAD SAVED DATA
// ==========================================

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

        document.getElementById(
            "iiko-ip"
        ).value = data.ip || "";

        document.getElementById(
            "iiko-port"
        ).value = data.port || "";

        document.getElementById(
            "iiko-login"
        ).value = data.login || "";

        document.getElementById(
            "iiko-password"
        ).value = data.password || "";

        rememberIiko.checked = true;

    } catch (error) {

        console.error(
            "Ошибка загрузки данных:",
            error
        );

        localStorage.removeItem(
            IIKO_STORAGE_KEY
        );
    }
}


// ==========================================
// SAVE DATA
// ==========================================

function saveIikoData() {

    const data = {

        ip:
            document.getElementById(
                "iiko-ip"
            ).value.trim(),

        port:
            document.getElementById(
                "iiko-port"
            ).value.trim(),

        login:
            document.getElementById(
                "iiko-login"
            ).value.trim(),

        password:
            document.getElementById(
                "iiko-password"
            ).value
    };

    localStorage.setItem(
        IIKO_STORAGE_KEY,
        JSON.stringify(data)
    );
}


// ==========================================
// CLEAR DATA
// ==========================================

clearIikoData.addEventListener(
    "click",
    function () {

        localStorage.removeItem(
            IIKO_STORAGE_KEY
        );

        document.getElementById(
            "iiko-ip"
        ).value = "";

        document.getElementById(
            "iiko-port"
        ).value = "";

        document.getElementById(
            "iiko-login"
        ).value = "";

        document.getElementById(
            "iiko-password"
        ).value = "";

        rememberIiko.checked = false;

        iikoConnection = null;

        salesCard.style.display =
            "none";

        statusElement.textContent =
            "⚪ Данные удалены";

        salesResult.innerHTML = "";
    }
);


// ==========================================
// CONNECT IIKO
// ==========================================

connectButton.addEventListener(
    "click",
    async function () {

        const ip =
            document.getElementById(
                "iiko-ip"
            ).value.trim();

        const port =
            document.getElementById(
                "iiko-port"
            ).value.trim();

        const login =
            document.getElementById(
                "iiko-login"
            ).value.trim();

        const password =
            document.getElementById(
                "iiko-password"
            ).value;


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            statusElement.textContent =
                "⚠️ Заполните все поля";

            return;
        }


        connectButton.disabled = true;

        connectButton.textContent =
            "Подключение...";

        statusElement.textContent =
            "⏳ Подключаемся к iiko Server...";


        try {

            const response =
                await fetch(
                    "/api/iiko/connect",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                ip,
                                port,
                                login,
                                password

                            })
                    }
                );


            const data =
                await response.json();


            console.log(
                "Ответ connect:",
                data
            );


            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.message ||
                    "Ошибка подключения"
                );
            }


            if (
                rememberIiko.checked
            ) {

                saveIikoData();

            } else {

                localStorage.removeItem(
                    IIKO_STORAGE_KEY
                );
            }


            iikoConnection = {

                ip,
                port,
                login,
                password

            };


            statusElement.textContent =
                "🟢 iiko Server подключён";


            salesCard.style.display =
                "block";


            // Добавляем кнопку OLAP
            addOlapButton();


        } catch (error) {

            console.error(
                "Ошибка подключения:",
                error
            );

            statusElement.textContent =
                "🔴 " +
                error.message;

        } finally {

            connectButton.disabled =
                false;

            connectButton.textContent =
                "Подключиться";
        }
    }
);


// ==========================================
// ADD OLAP BUTTON
// ==========================================

function addOlapButton() {

    if (
        document.getElementById(
            "check-olap"
        )
    ) {
        return;
    }


    const button =
        document.createElement(
            "button"
        );


    button.id =
        "check-olap";


    button.type =
        "button";


    button.textContent =
        "🔍 Проверить OLAP API";


    button.style.width =
        "100%";


    button.style.padding =
        "14px";


    button.style.marginTop =
        "15px";


    button.style.border =
        "1px solid #ddd";


    button.style.borderRadius =
        "8px";


    button.style.background =
        "#fff";


    button.style.color =
        "#222";


    button.style.cursor =
        "pointer";


    salesCard.appendChild(
        button
    );


    button.addEventListener(
        "click",
        checkOlap
    );
}


// ==========================================
// CHECK OLAP
// ==========================================

async function checkOlap() {

    if (!iikoConnection) {

        alert(
            "Сначала подключитесь к iiko Server"
        );

        return;
    }


    const button =
        document.getElementById(
            "check-olap"
        );


    button.disabled = true;

    button.textContent =
        "⏳ Проверяем OLAP...";


    const oldResult =
        salesResult.innerHTML;


    salesResult.innerHTML = `

        <div style="
            margin-top:20px;
            padding:15px;
            border-radius:8px;
            background:#f5f5f5;
            color:#222;
        ">

            ⏳ Отправляем запрос
            в iiko OLAP API...

        </div>

    `;


    try {

        const response =
            await fetch(
                "/api/iiko/olap",
                {
                    method: "POST",

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
                                iikoConnection.password

                        })
                }
            );


        const data =
            await response.json();


        console.log(
            "OLAP RESPONSE:",
            data
        );


        let resultHtml = "";


        if (data.success) {

            resultHtml += `

                <div style="
                    margin-top:20px;
                    padding:15px;
                    border-radius:8px;
                    background:#e9f8ee;
                    color:#176b32;
                ">

                    🟢 OLAP API работает

                    <br><br>

                    HTTP:

                    <strong>
                        ${data.iikoHttpStatus}
                    </strong>

                </div>

            `;

        } else {

            resultHtml += `

                <div style="
                    margin-top:20px;
                    padding:15px;
                    border-radius:8px;
                    background:#fff0f0;
                    color:#b00000;
                ">

                    🔴 OLAP API вернул ошибку

                    <br><br>

                    HTTP:

                    <strong>
                        ${data.iikoHttpStatus || "-"}
                    </strong>

                    <br><br>

                    ${escapeHtml(
                        data.message || ""
                    )}

                </div>

            `;
        }


        // ======================================
        // RAW RESPONSE
        // ======================================

        resultHtml += `

            <div style="
                margin-top:15px;
            ">

                <h3>
                    Ответ iiko:
                </h3>

                <pre style="
                    white-space:pre-wrap;
                    overflow:auto;
                    padding:15px;
                    border-radius:8px;
                    background:#f5f5f5;
                    color:#222;
                    border:1px solid #ddd;
                    font-size:13px;
                    line-height:1.5;
                ">${escapeHtml(
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                )}</pre>

            </div>

        `;


        salesResult.innerHTML =
            resultHtml;


    } catch (error) {

        console.error(
            "OLAP ERROR:",
            error
        );


        salesResult.innerHTML = `

            <div style="
                margin-top:20px;
                padding:15px;
                border-radius:8px;
                background:#fff0f0;
                color:#b00000;
            ">

                🔴 Ошибка:

                ${escapeHtml(
                    error.message
                )}

            </div>

        `;


    } finally {

        button.disabled = false;

        button.textContent =
            "🔍 Проверить OLAP API";
    }
}


// ==========================================
// SALES REPORT
// ==========================================

loadSalesButton.addEventListener(
    "click",
    async function () {

        if (!iikoConnection) {

            salesResult.innerHTML = `

                <div class="report-error">

                    ⚠️ Сначала подключитесь
                    к iiko Server

                </div>

            `;

            return;
        }


        const from =
            document.getElementById(
                "report-from"
            ).value;


        const to =
            document.getElementById(
                "report-to"
            ).value;


        if (!from || !to) {

            salesResult.innerHTML = `

                <div class="report-error">

                    ⚠️ Выберите период

                </div>

            `;

            return;
        }


        if (from > to) {

            salesResult.innerHTML = `

                <div class="report-error">

                    ⚠️ Дата начала
                    не может быть позже
                    даты окончания

                </div>

            `;

            return;
        }


        loadSalesButton.disabled =
            true;

        loadSalesButton.textContent =
            "Загрузка...";


        salesResult.innerHTML = `

            <div class="report-loading">

                ⏳ Получаем данные из iiko...

            </div>

        `;


        try {

            const response =
                await fetch(
                    "/api/iiko/sales",
                    {
                        method: "POST",

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

                                from:
                                    from,

                                to:
                                    to

                            })
                    }
                );


            const data =
                await response.json();


            console.log(
                "Ответ sales:",
                data
            );


            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.message ||
                    "Ошибка получения отчёта"
                );
            }


            const report =
                data.report || {};


            const rows =
                Array.isArray(
                    report.data
                )
                    ? report.data
                    : [];


            let totalSales = 0;

            let totalOrders = 0;


            rows.forEach(
                row => {

                    totalSales +=
                        Number(
                            row.DishSumInt || 0
                        );

                    totalOrders +=
                        Number(
                            row.UniqOrderId || 0
                        );
                }
            );


            const averageCheck =
                totalOrders > 0
                    ? totalSales /
                      totalOrders
                    : 0;


            const money =
                new Intl.NumberFormat(
                    "ru-RU",
                    {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }
                );


            const number =
                new Intl.NumberFormat(
                    "ru-RU"
                );


            function formatDate(
                dateString
            ) {

                if (!dateString) {
                    return "-";
                }

                const parts =
                    dateString.split("-");

                if (
                    parts.length !== 3
                ) {
                    return dateString;
                }

                return (
                    parts[2] +
                    "." +
                    parts[1] +
                    "." +
                    parts[0]
                );
            }


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

                            ${money.format(
                                totalSales
                            )}

                        </div>

                    </div>


                    <div class="report-card">

                        <div class="report-card-title">
                            🧾 Заказы
                        </div>

                        <div class="report-card-value">

                            ${number.format(
                                totalOrders
                            )}

                        </div>

                    </div>


                    <div class="report-card">

                        <div class="report-card-title">
                            💵 Средний чек
                        </div>

                        <div class="report-card-value">

                            ${money.format(
                                averageCheck
                            )}

                        </div>

                    </div>

                </div>


                <div class="report-table-wrapper">

                    <h3>
                        Продажи по дням
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


            if (
                rows.length === 0
            ) {

                html += `

                    <tr>

                        <td
                            colspan="4"
                            class="empty-report"
                        >

                            Продаж за выбранный
                            период нет

                        </td>

                    </tr>

                `;

            } else {

                rows.forEach(
                    row => {

                        const sales =
                            Number(
                                row.DishSumInt || 0
                            );

                        const orders =
                            Number(
                                row.UniqOrderId || 0
                            );

                        const average =
                            orders > 0
                                ? sales / orders
                                : 0;

                        const date =
                            row[
                                "OpenDate.Typed"
                            ];


                        html += `

                            <tr>

                                <td>
                                    ${formatDate(
                                        date
                                    )}
                                </td>

                                <td>
                                    ${money.format(
                                        sales
                                    )}
                                </td>

                                <td>
                                    ${number.format(
                                        orders
                                    )}
                                </td>

                                <td>
                                    ${money.format(
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


        } catch (error) {

            console.error(
                "Ошибка отчёта:",
                error
            );


            salesResult.innerHTML = `

                <div class="report-error">

                    🔴

                    ${escapeHtml(
                        error.message
                    )}

                </div>

            `;

        } finally {

            loadSalesButton.disabled =
                false;

            loadSalesButton.textContent =
                "Получить отчёт";
        }

    }
);


// ==========================================
// ESCAPE HTML
// ==========================================

function escapeHtml(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );
}


// ==========================================
// START
// ==========================================

loadSavedIikoData();
