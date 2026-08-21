const connectButton = document.getElementById("connect-iiko");
const statusElement = document.getElementById("iiko-status");
const salesCard = document.getElementById("sales-card");
const loadSalesButton = document.getElementById("load-sales");
const salesResult = document.getElementById("sales-result");

let iikoConnection = null;


// ==========================================
// ПОДКЛЮЧЕНИЕ К IIKO
// ==========================================

connectButton.addEventListener("click", async function () {

    console.log("КНОПКА ПОДКЛЮЧЕНИЯ НАЖАТА");

    const ip =
        document.getElementById("iiko-ip").value.trim();

    const port =
        document.getElementById("iiko-port").value.trim();

    const login =
        document.getElementById("iiko-login").value.trim();

    const password =
        document.getElementById("iiko-password").value;


    if (!ip || !port || !login || !password) {

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

        const response = await fetch(
            "/api/iiko/connect",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
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


        if (!response.ok || !data.success) {

            throw new Error(
                data.message ||
                "Ошибка подключения"
            );
        }


        iikoConnection = {
            ip: ip,
            port: port,
            login: login,
            password: password
        };


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
            "🔴 " + error.message;


    } finally {

        connectButton.disabled = false;

        connectButton.textContent =
            "Подключиться";
    }

});


// ==========================================
// ОТЧЁТ ПРОДАЖ
// ==========================================

loadSalesButton.addEventListener(
    "click",
    async function () {

        if (!iikoConnection) {

            salesResult.innerHTML =
                `<div class="report-error">
                    ⚠️ Сначала подключитесь к iiko Server
                </div>`;

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

            salesResult.innerHTML =
                `<div class="report-error">
                    ⚠️ Выберите период
                </div>`;

            return;
        }


        if (from > to) {

            salesResult.innerHTML =
                `<div class="report-error">
                    ⚠️ Дата начала не может быть позже даты окончания
                </div>`;

            return;
        }


        loadSalesButton.disabled = true;

        loadSalesButton.textContent =
            "Загрузка...";


        salesResult.innerHTML =
            `<div class="report-loading">
                ⏳ Получаем данные из iiko...
            </div>`;


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

                        body: JSON.stringify({

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


            if (!response.ok ||
                !data.success) {

                throw new Error(
                    data.message ||
                    "Ошибка получения отчёта"
                );
            }


            // ==================================
            // ДАННЫЕ IIKO
            // ==================================

            const report =
                data.report || {};


            const rows =
                Array.isArray(report.data)
                    ? report.data
                    : [];


            console.log(
                "Строки отчёта:",
                rows
            );


            // ==================================
            // ОБЩАЯ ВЫРУЧКА
            // ==================================

            let totalSales = 0;

            let totalOrders = 0;


            rows.forEach(row => {

                totalSales +=
                    Number(
                        row.DishSumInt || 0
                    );


                totalOrders +=
                    Number(
                        row.UniqOrderId || 0
                    );

            });


            // ==================================
            // СРЕДНИЙ ЧЕК
            // ==================================

            let averageCheck = 0;


            if (totalOrders > 0) {

                averageCheck =
                    totalSales /
                    totalOrders;
            }


            // ==================================
            // ФОРМАТИРОВАНИЕ
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


                if (parts.length !== 3) {
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
            // HTML ОТЧЁТА
            // ==================================

            let html = "";


            html += `
                <div class="report-header">

                    <div>

                        <h2>
                            📊 Отчёт о продажах
                        </h2>

                        <div class="report-period">
                            ${formatDate(from)}
                            —
                            ${formatDate(to)}
                        </div>

                    </div>

                </div>
            `;


            // ==================================
            // КАРТОЧКИ
            // ==================================

            html += `

                <div class="report-cards">

                    <div class="report-card">

                        <div class="report-card-title">
                            💰 Выручка
                        </div>

                        <div class="report-card-value">
                            ${money.format(totalSales)}
                        </div>

                    </div>


                    <div class="report-card">

                        <div class="report-card-title">
                            🧾 Заказы
                        </div>

                        <div class="report-card-value">
                            ${number.format(totalOrders)}
                        </div>

                    </div>


                    <div class="report-card">

                        <div class="report-card-title">
                            💵 Средний чек
                        </div>

                        <div class="report-card-value">
                            ${money.format(averageCheck)}
                        </div>

                    </div>

                </div>
            `;


            // ==================================
            // ТАБЛИЦА
            // ==================================

            html += `

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


            if (rows.length === 0) {

                html += `

                    <tr>

                        <td
                            colspan="4"
                            class="empty-report"
                        >
                            Продаж за выбранный период нет
                        </td>

                    </tr>

                `;

            } else {

                rows.forEach(row => {

                    const sales =
                        Number(
                            row.DishSumInt || 0
                        );


                    const orders =
                        Number(
                            row.UniqOrderId || 0
                        );


                    const avg =
                        orders > 0
                            ? sales / orders
                            : 0;


                    html += `

                        <tr>

                            <td>
                                ${formatDate(
                                    row["OpenDate.Typed"]
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
                                    avg
                                )}
                            </td>

                        </tr>

                    `;

                });

            }


            html += `

                        </tbody>

                    </table>

                </div>

            `;


            // ==================================
            // ПОКАЗЫВАЕМ ОТЧЁТ
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

                    🔴 ${escapeHtml(
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
// ЗАЩИТА HTML
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
