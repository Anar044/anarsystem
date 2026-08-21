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
// STORAGE KEY
// ==========================================

const IIKO_STORAGE_KEY =
    "iikoConnection";


// ==========================================
// ЗАГРУЗКА СОХРАНЁННЫХ ДАННЫХ
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
        ).value =
            data.ip || "";


        document.getElementById(
            "iiko-port"
        ).value =
            data.port || "";


        document.getElementById(
            "iiko-login"
        ).value =
            data.login || "";


        document.getElementById(
            "iiko-password"
        ).value =
            data.password || "";


        rememberIiko.checked = true;


        console.log(
            "Данные iiko загружены из браузера"
        );


    } catch (error) {

        console.error(
            "Ошибка загрузки сохранённых данных:",
            error
        );


        localStorage.removeItem(
            IIKO_STORAGE_KEY
        );
    }
}


// ==========================================
// СОХРАНЕНИЕ
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


    console.log(
        "Данные iiko сохранены"
    );
}


// ==========================================
// УДАЛЕНИЕ СОХРАНЁННЫХ ДАННЫХ
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


        console.log(
            "Сохранённые данные iiko удалены"
        );
    }
);


// ==========================================
// ПОДКЛЮЧЕНИЕ К IIKO
// ==========================================

connectButton.addEventListener(
    "click",
    async function () {


        console.log(
            "КНОПКА ПОДКЛЮЧЕНИЯ НАЖАТА"
        );


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


        // ======================================
        // ПРОВЕРКА
        // ======================================

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


        // ======================================
        // BUTTON
        // ======================================

        connectButton.disabled =
            true;


        connectButton.textContent =
            "Подключение...";


        statusElement.textContent =
            "⏳ Подключаемся к iiko Server...";


        try {


            // ==================================
            // CONNECT API
            // ==================================

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

                                ip: ip,

                                port: port,

                                login: login,

                                password: password

                            })
                    }
                );


            const data =
                await response.json();


            console.log(
                "Ответ connect:",
                data
            );


            // ==================================
            // ERROR
            // ==================================

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.message ||
                    "Ошибка подключения"
                );
            }


            // ==================================
            // SAVE
            // ==================================

            if (
                rememberIiko.checked
            ) {

                saveIikoData();

            } else {

                localStorage.removeItem(
                    IIKO_STORAGE_KEY
                );
            }


            // ==================================
            // CONNECTION OBJECT
            // ==================================

            iikoConnection = {

                ip: ip,

                port: port,

                login: login,

                password: password

            };


            // ==================================
            // SUCCESS
            // ==================================

            statusElement.textContent =
                "🟢 iiko Server подключён";


            salesCard.style.display =
                "block";


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
// ПОЛУЧЕНИЕ ОТЧЁТА
// ==========================================

loadSalesButton.addEventListener(
    "click",
    async function () {


        // ======================================
        // CONNECTION
        // ======================================

        if (!iikoConnection) {

            salesResult.innerHTML = `

                <div class="report-error">

                    ⚠️ Сначала подключитесь
                    к iiko Server

                </div>

            `;

            return;
        }


        // ======================================
        // DATES
        // ======================================

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


        // ======================================
        // BUTTON
        // ======================================

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


            // ==================================
            // API
            // ==================================

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


            // ==================================
            // ERROR
            // ==================================

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.message ||
                    "Ошибка получения отчёта"
                );
            }


            // ==================================
            // REPORT
            // ==================================

            const report =
                data.report || {};


            const rows =
                Array.isArray(
                    report.data
                )
                    ? report.data
                    : [];


            // ==================================
            // TOTALS
            // ==================================

            let totalSales = 0;

            let totalOrders = 0;


            rows.forEach(
                function (row) {

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


            // ==================================
            // AVERAGE CHECK
            // ==================================

            const averageCheck =
                totalOrders > 0
                    ? totalSales /
                      totalOrders
                    : 0;


            // ==================================
            // FORMATTERS
            // ==================================

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


            // ==================================
            // REPORT HTML
            // ==================================

            let html = "";


            // HEADER

            html += `

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

            `;


            // CARDS

            html += `

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

            `;


            // TABLE

            html += `

                <div class="report-table-wrapper">


                    <h3>

                        Продажи по дням

                    </h3>


                    <table
                        class="report-table"
                    >

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


            // ==================================
            // EMPTY
            // ==================================

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


                // ==================================
                // ROWS
                // ==================================

                rows.forEach(
                    function (row) {


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


            // ==================================
            // SHOW
            // ==================================

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
// HTML SECURITY
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
