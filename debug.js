(function () {
    "use strict";

    const $ = id => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));
    }

    function addTrace(level, message, detail = "") {
        const trace = $("debug-trace");
        if (!trace) return;
        if (trace.querySelector(".trace-empty")) trace.innerHTML = "";

        const item = document.createElement("div");
        item.className = "trace-item";
        const time = new Date().toLocaleTimeString("ru-RU");
        item.innerHTML = `
            <div><span class="trace-time">${esc(time)}</span><span class="trace-level ${esc(level)}">${esc(level.toUpperCase())}</span>${esc(message)}</div>
            ${detail ? `<div class="trace-detail">${esc(detail)}</div>` : ""}
        `;
        trace.appendChild(item);
        trace.scrollTop = trace.scrollHeight;
    }

    function clearTrace() {
        const trace = $("debug-trace");
        if (trace) trace.innerHTML = '<div class="trace-empty">Нажмите «Проверить».</div>';
        const result = $("debug-result");
        if (result) result.textContent = "Ожидание проверки.";
    }

    async function run() {
        const ip = $("debug-ip")?.value.trim();
        const port = $("debug-port")?.value.trim();
        const login = $("debug-login")?.value.trim();
        const password = $("debug-password")?.value || "";
        const button = $("debug-run");
        const result = $("debug-result");

        clearTrace();

        if (!ip || !port || !login || !password) {
            addTrace("err", "Проверка остановлена", "Заполните IP, порт, логин и пароль.");
            return;
        }

        button.disabled = true;
        button.textContent = "Проверяем...";
        result.textContent = "Отправляем запрос в диагностический API...";

        addTrace("info", "POST /api/iiko/debug", `server=${ip}:${port}`);
        addTrace("info", "Подготовка запроса", "Пароль будет передан серверу, но не попадёт в лог.");

        try {
            const response = await fetch("/api/iiko/debug", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({ ip, port, login, password })
            });

            const data = await response.json().catch(() => ({}));

            if (Array.isArray(data.trace)) {
                data.trace.forEach(item => {
                    addTrace(item.level || "info", item.message || "", item.detail || "");
                });
            }

            if (!response.ok || data.success === false) {
                result.innerHTML = `<span class="danger">Ошибка:</span> ${esc(data.message || `HTTP ${response.status}`)}`;
                return;
            }

            result.textContent = data.message || "Проверка завершена.";
        } catch (error) {
            addTrace("err", "Ошибка браузерного запроса", error.message || String(error));
            result.innerHTML = '<span class="danger">Не удалось обратиться к диагностическому API.</span>';
        } finally {
            button.disabled = false;
            button.textContent = "Проверить";
        }
    }

    function loadSaved() {
        try {
            const saved = JSON.parse(localStorage.getItem("iikoConnection") || "null");
            if (!saved) return;
            $("debug-ip").value = saved.ip || "";
            $("debug-port").value = saved.port || "";
            $("debug-login").value = saved.login || "";
            $("debug-password").value = saved.password || "";
        } catch (_) {}
    }

    document.addEventListener("DOMContentLoaded", () => {
        loadSaved();
        $("debug-run")?.addEventListener("click", run);
        $("debug-clear")?.addEventListener("click", clearTrace);
    });
})();
