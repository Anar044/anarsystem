# reports.js

```javascript
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


// Данные подключения храним только в памяти страницы
let iikoConnection = null;


// ========================================
// ПОДКЛЮЧЕНИЕ К IIKO
// ========================================

connectButton.addEventListener("click", async () => {
console.log("КНОПКА ПОДКЛЮЧЕНИЯ НАЖАТА");

    const ip =
        document.getElementById("iiko-ip")
            .value
            .trim();

    const port =
        document.getElementById("iiko-port")
            .value
            .trim();

    const login =
        document.getElementById("iiko-login")
            .value
            .trim();

    const password =
        document.getElementById("iiko-password")
            .value;


    // Проверяем поля

    if (!ip || !port || !login || !password) {

        statusElement.textContent =
            "⚠️ Заполните все поля";

        return;
    }


    // Блокируем кнопку

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


        if (!response.ok ||
            !data.success) {

            throw new Error(
                data.message ||
                "Ошибка подключения"
            );
        }


        // Сохраняем данные подключения
        // только в памяти браузера

        iikoConnection = {
            ip: ip,
            port: port,
            login: login,
            password: password
        };


        statusElement.textContent =
            "🟢 iiko Server подключён";


        // Показываем отчёты

        salesCard.style.display =
            "block";


    } catch (error) {

        console.error(
            "iiko connection error:",
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



// ========================================
// ПОЛУЧЕНИЕ ОТЧЁТА ПО ПРОДАЖАМ
// ========================================

loadSalesButton.addEventListener(
    "click",
    async () => {


        // Проверяем подключение

        if (!iikoConnection) {

            salesResult.innerHTML =
                "⚠️ Сначала подключитесь к iiko Server";

            return;
        }


        // Получаем даты

        const from =
            document.getElementById(
                "report-from"
            ).value;

        const to =
            document.getElementById(
                "report-to"
            ).value;


        // Проверяем даты

        if (!from || !to) {

            salesResult.innerHTML =
                "⚠️ Укажите дату от и дату до";

            return;
        }


        if (from > to) {

            salesResult.innerHTML =
                "⚠️ Дата начала не может быть позже даты окончания";

            return;
        }


        // Блокируем кнопку

        loadSalesButton.disabled =
            true;

        loadSalesButton.textContent =
            "Загрузка...";

        salesResult.innerHTML =
            "⏳ Получаем данные из iiko...";


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


            if (!response.ok ||
                !data.success) {

                throw new Error(
                    data.message ||
                    "Ошибка получения отчёта"
                );
            }


            console.log(
                "iiko SALES:",
                data.report
            );


            // Пока показываем настоящий
            // ответ iiko API

            salesResult.innerHTML = `
                <div>
                    <strong>
                        ✅ Отчёт получен
                    </strong>
                </div>

                <pre>${escapeHtml(
                    JSON.stringify(
                        data.report,
                        null,
                        2
                    )
                )}</pre>
            `;


        } catch (error) {

            console.error(
                "sales error:",
                error
            );

            salesResult.innerHTML =
                "🔴 " +
                escapeHtml(
                    error.message
                );


        } finally {

            loadSalesButton.disabled =
                false;

            loadSalesButton.textContent =
                "Получить отчёт";
        }

    }
);



// ========================================
// ЗАЩИТА HTML
// ========================================

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
```
