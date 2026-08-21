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

    const ip = document.getElementById("iiko-ip").value.trim();
    const port = document.getElementById("iiko-port").value.trim();
    const login = document.getElementById("iiko-login").value.trim();
    const password = document.getElementById("iiko-password").value;

    if (!ip || !port || !login || !password) {
        statusElement.textContent = "⚠️ Заполните все поля";
        return;
    }

    connectButton.disabled = true;
    connectButton.textContent = "Подключение...";
    statusElement.textContent = "⏳ Подключаемся к iiko Server...";

    try {

        const response = await fetch("/api/iiko/connect", {
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
        });

        const data = await response.json();

        console.log("Ответ connect:", data);

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Ошибка подключения"
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

        salesCard.style.display = "block";

    } catch (error) {

        console.error("Ошибка подключения:", error);

        statusElement.textContent =
            "🔴 " + error.message;

    } finally {

        connectButton.disabled = false;
        connectButton.textContent = "Подключиться";
    }
});


// ==========================================
// ОТЧЁТ ПРОДАЖ
// ==========================================

loadSalesButton.addEventListener("click", async function () {

    if (!iikoConnection) {
        salesResult.textContent =
            "⚠️ Сначала подключитесь к iiko Server";
        return;
    }

    const from =
        document.getElementById("report-from").value;

    const to =
        document.getElementById("report-to").value;

    if (!from || !to) {
        salesResult.textContent =
            "⚠️ Выберите дату от и дату до";
        return;
    }

    if (from > to) {
        salesResult.textContent =
            "⚠️ Дата начала не может быть позже даты окончания";
        return;
    }

    loadSalesButton.disabled = true;
    loadSalesButton.textContent = "Загрузка...";

    salesResult.textContent =
        "⏳ Получаем данные из iiko...";

    try {

        const response = await fetch("/api/iiko/sales", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ip: iikoConnection.ip,
                port: iikoConnection.port,
                login: iikoConnection.login,
                password: iikoConnection.password,
                from: from,
                to: to
            })
        });

        const data = await response.json();

        console.log("Ответ sales:", data);

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Ошибка получения отчёта"
            );
        }

        salesResult.innerHTML =
            "<strong>✅ Отчёт получен</strong>";

        const pre = document.createElement("pre");

        pre.textContent =
            JSON.stringify(data.report, null, 2);

        salesResult.appendChild(pre);

    } catch (error) {

        console.error("Ошибка отчёта:", error);

        salesResult.textContent =
            "🔴 " + error.message;

    } finally {

        loadSalesButton.disabled = false;
        loadSalesButton.textContent =
            "Получить отчёт";
    }
});
