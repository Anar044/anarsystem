(function () {
    "use strict";

    const config = window.SH_AUTH_CONFIG || {};
    const ready = Boolean(
        config.url &&
        config.publishableKey &&
        !config.url.includes("YOUR_PROJECT") &&
        !config.publishableKey.includes("YOUR_SUPABASE")
    );

    let client = null;
    let authReady = false;

    function byId(id) {
        return document.getElementById(id);
    }

    function showMessage(text, type) {
        const box = byId("auth-message");
        if (!box) return;
        box.textContent = text || "";
        box.className = `auth-message ${type || ""}`.trim();
        box.hidden = !text;
    }

    function setBusy(button, busy, text) {
        if (!button) return;
        if (busy) {
            button.dataset.originalText = button.textContent;
            button.disabled = true;
            button.textContent = text || "Подождите...";
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || button.textContent;
        }
    }

    function redirectTarget() {
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");
        if (next && next.startsWith("/") && !next.startsWith("//")) return next;
        return "index.html";
    }

    function loginUrl(next) {
        const target = next && next.startsWith("/") ? next : "index.html";
        return `login.html?next=${encodeURIComponent(target)}`;
    }

    function requireConfigured() {
        if (ready) return true;
        showMessage(
            "Сначала настройте Supabase в auth-config.js: укажите URL проекта и Publishable Key.",
            "error"
        );
        return false;
    }

    async function createClient() {
        if (client) return client;
        if (!ready) return null;

        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            throw new Error("Не удалось загрузить Supabase Auth.");
        }

        client = window.supabase.createClient(
            config.url,
            config.publishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );

        authReady = true;
        return client;
    }

    async function getUser() {
        const sb = await createClient();
        if (!sb) return null;
        const { data, error } = await sb.auth.getUser();
        if (error) return null;
        return data.user || null;
    }

    async function protectPage() {
        if (!requireConfigured()) return;
        const user = await getUser();
        if (!user) {
            const current = window.location.pathname.split("/").pop() || "index.html";
            window.location.replace(loginUrl(`/${current}`));
            return;
        }
        window.SH_CURRENT_USER = user;
        document.documentElement.classList.add("auth-user-ready");
        document.dispatchEvent(new CustomEvent("sh-auth-ready", { detail: user }));
    }

    async function initLogin() {
        if (!requireConfigured()) return;

        const sb = await createClient();
        const user = await getUser();
        if (user) {
            window.location.replace(redirectTarget());
            return;
        }

        const form = byId("login-form");
        if (!form) return;

        form.addEventListener("submit", async event => {
            event.preventDefault();
            showMessage("");

            const email = byId("login-email")?.value.trim();
            const password = byId("login-password")?.value || "";
            const button = form.querySelector("button[type=submit]");

            if (!email || !password) {
                showMessage("Введите email и пароль.", "error");
                return;
            }

            setBusy(button, true, "Входим...");

            const { data, error } = await sb.auth.signInWithPassword({ email, password });

            setBusy(button, false);

            if (error) {
                const message = /email not confirmed/i.test(error.message)
                    ? "Email ещё не подтверждён. Проверьте почту и перейдите по ссылке из письма."
                    : "Не удалось войти. Проверьте email и пароль.";
                showMessage(message, "error");
                return;
            }

            if (!data.user) {
                showMessage("Не удалось создать сессию.", "error");
                return;
            }

            window.location.replace(redirectTarget());
        });
    }

    async function initRegister() {
        if (!requireConfigured()) return;

        const sb = await createClient();
        const existing = await getUser();
        if (existing) {
            window.location.replace("index.html");
            return;
        }

        const form = byId("register-form");
        if (!form) return;

        form.addEventListener("submit", async event => {
            event.preventDefault();
            showMessage("");

            const firstName = byId("register-first-name")?.value.trim();
            const lastName = byId("register-last-name")?.value.trim();
            const email = byId("register-email")?.value.trim().toLowerCase();
            const phone = byId("register-phone")?.value.trim();
            const password = byId("register-password")?.value || "";
            const password2 = byId("register-password2")?.value || "";
            const terms = byId("register-terms")?.checked;
            const button = form.querySelector("button[type=submit]");

            if (!firstName || !lastName || !email || !phone || !password || !password2) {
                showMessage("Заполните все поля.", "error");
                return;
            }

            if (!terms) {
                showMessage("Подтвердите согласие с условиями использования.", "error");
                return;
            }

            if (password.length < 8) {
                showMessage("Пароль должен содержать минимум 8 символов.", "error");
                return;
            }

            if (password !== password2) {
                showMessage("Пароли не совпадают.", "error");
                return;
            }

            setBusy(button, true, "Создаём аккаунт...");

            const redirectTo = `${window.location.origin}/auth-callback.html`;
            const { data, error } = await sb.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: redirectTo,
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        phone
                    }
                }
            });

            setBusy(button, false);

            if (error) {
                showMessage(error.message || "Не удалось зарегистрировать аккаунт.", "error");
                return;
            }

            if (data.session) {
                window.location.replace("index.html");
                return;
            }

            form.reset();
            showMessage(
                `Регистрация создана. Мы отправили письмо на ${email}. Подтвердите email, затем войдите в SH_Reports.`,
                "success"
            );
        });
    }

    async function initForgotPassword() {
        if (!requireConfigured()) return;

        const sb = await createClient();
        const form = byId("forgot-form");
        if (!form) return;

        form.addEventListener("submit", async event => {
            event.preventDefault();
            showMessage("");

            const email = byId("forgot-email")?.value.trim().toLowerCase();
            const button = form.querySelector("button[type=submit]");

            if (!email) {
                showMessage("Введите email.", "error");
                return;
            }

            setBusy(button, true, "Отправляем...");
            const { error } = await sb.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password.html`
            });
            setBusy(button, false);

            if (error) {
                showMessage(error.message || "Не удалось отправить письмо.", "error");
                return;
            }

            showMessage("Если этот email зарегистрирован, письмо для восстановления уже отправлено.", "success");
        });
    }

    async function initResetPassword() {
        if (!requireConfigured()) return;

        const sb = await createClient();
        const form = byId("reset-form");
        if (!form) return;

        const { data: sessionData } = await sb.auth.getSession();
        if (!sessionData.session) {
            showMessage("Ссылка для восстановления недействительна или истекла. Запросите новое письмо.", "error");
            return;
        }

        form.addEventListener("submit", async event => {
            event.preventDefault();
            showMessage("");

            const password = byId("reset-password")?.value || "";
            const password2 = byId("reset-password2")?.value || "";
            const button = form.querySelector("button[type=submit]");

            if (password.length < 8) {
                showMessage("Пароль должен содержать минимум 8 символов.", "error");
                return;
            }

            if (password !== password2) {
                showMessage("Пароли не совпадают.", "error");
                return;
            }

            setBusy(button, true, "Сохраняем...");
            const { error } = await sb.auth.updateUser({ password });
            setBusy(button, false);

            if (error) {
                showMessage(error.message || "Не удалось изменить пароль.", "error");
                return;
            }

            showMessage("Пароль изменён. Теперь можно войти в SH_Reports.", "success");
            setTimeout(() => window.location.replace("index.html"), 1200);
        });
    }

    async function initCallback() {
        if (!requireConfigured()) return;

        const sb = await createClient();
        showMessage("Подтверждаем email...", "info");

        const params = new URLSearchParams(window.location.search);
        const tokenHash = params.get("token_hash");
        const type = params.get("type");

        if (tokenHash && type) {
            const { error } = await sb.auth.verifyOtp({
                token_hash: tokenHash,
                type
            });
            if (error) {
                showMessage("Не удалось подтвердить email. Запросите новое письмо.", "error");
                return;
            }
        }

        const { data } = await sb.auth.getSession();
        if (data.session) {
            showMessage("Email подтверждён. Входим в SH_Reports...", "success");
            setTimeout(() => window.location.replace("index.html"), 500);
            return;
        }

        showMessage("Email подтверждён. Теперь войдите в SH_Reports.", "success");
        setTimeout(() => window.location.replace("login.html"), 900);
    }

    async function initUserUI() {
        const user = window.SH_CURRENT_USER || await getUser();
        if (!user) return;

        const meta = user.user_metadata || {};
        const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || user.email || "Пользователь";
        document.querySelectorAll("[data-auth-name]").forEach(el => el.textContent = name);
        document.querySelectorAll("[data-auth-email]").forEach(el => el.textContent = user.email || "");
        document.querySelectorAll("[data-auth-avatar]").forEach(el => el.textContent = (meta.first_name || user.email || "S").charAt(0).toUpperCase());

        document.querySelectorAll("[data-auth-logout]").forEach(button => {
            button.addEventListener("click", async () => {
                const sb = await createClient();
                await sb.auth.signOut();
                window.location.replace("login.html");
            });
        });
    }

    async function initProtected() {
        await protectPage();
        await initUserUI();
    }

    window.SHAuth = {
        createClient,
        getUser,
        protectPage,
        initUserUI,
        signOut: async function () {
            const sb = await createClient();
            if (sb) await sb.auth.signOut();
            window.location.replace("login.html");
        }
    };

    document.addEventListener("DOMContentLoaded", async () => {
        const page = document.body.dataset.authPage || "";
        try {
            if (page === "login") await initLogin();
            else if (page === "register") await initRegister();
            else if (page === "forgot") await initForgotPassword();
            else if (page === "reset") await initResetPassword();
            else if (page === "callback") await initCallback();
            else if (document.body.dataset.protected === "true") await initProtected();
        } catch (error) {
            console.error("SH_Reports Auth error:", error);
            showMessage(error.message || "Ошибка авторизации.", "error");
        }
    });
})();
