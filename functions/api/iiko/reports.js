const connectButton = document.getElementById("connect-iiko");
const statusElement = document.getElementById("iiko-status");

connectButton.addEventListener("click", async () => {

    const ip = document.getElementById("iiko-ip").value.trim();
    const port = document.getElementById("iiko-port").value.trim();
    const login = document.getElementById("iiko-login").value.trim();
    const password = document.getElementById("iiko-password").value;

    if (!ip || !port || !login || !password) {
        statusElement.textContent = "Заполните все поля";
        return;
    }

    connectButton.disabled = true;
    connectButton.textContent = "Подключение...";
    statusElement.textContent = "Подключаемся к iiko Server...";

    try {

        const response = await fetch("/api/iiko/connect", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                ip,
                port,
                login,
                password
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Ошибка подключения");
        }

        statusElement.textContent = "🟢 iiko Server подключён";

        /*
         * Пока токен только проверяем.
         * На следующем этапе сделаем отдельные API-запросы
         * для получения отчётов.
         */

        console.log("iiko token получен");

    } catch (error) {

        console.error(error);

        statusElement.textContent =
            "🔴 " + error.message;

    } finally {

        connectButton.disabled = false;
        connectButton.textContent = "Подключиться";
    }
});
