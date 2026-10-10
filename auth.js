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

    function byId(id) { return document.getElementById(id); }

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

    function captureInvite() {
        const params = new URLSearchParams(window.location.search);
        const invite = params.get("invite") || "";
        if (invite) {
            try { localStorage.setItem("sh_pending_invite", invite); } catch {}
            return invite;
        }
        try { return localStorage.getItem("sh_pending_invite") || ""; } catch { return ""; }
    }

    async function invitePreview(invite) {
        if (!invite) return null;
        try {
            const response = await fetch('/api/access/invite?token=' + encodeURIComponent(invite), { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            return response.ok && data.success ? data.invite : null;
        } catch { return null; }
    }

    function inviteCallbackUrl(invite) {
        const url = new URL("/auth-callback.html", window.location.origin);
        if (invite) url.searchParams.set("invite", invite);
        return url.toString();
    }

    function invitedUserMessage(reason) {
        const messages = {
            INVITE_NOT_FOUND: "Ссылка приглашения недействительна или уже использована. Попросите администратора выдать новую.",
            INVITE_EXPIRED: "Приглашение истекло. Попросите администратора отправить новую ссылку.",
            INVITE_EMAIL_MISMATCH: "Сейчас вы вошли под другим email. Откройте приглашение с адресом, на который его отправили.",
            INVITE_ALREADY_USED: "Приглашение уже принято другим аккаунтом. Обратитесь к администратору.",
            INVITE_MEMBER_NOT_FOUND: "Приглашение больше не связано с пользователем организации.",
            NO_MEMBERSHIP: "Учётная запись подтверждена, но приглашение не было применено. Откройте исходную ссылку приглашения ещё раз.",
            MEMBERSHIP_DISABLED: "Администратор отключил доступ к организации."
        };
        return messages[reason] || "Не удалось принять приглашение. Попросите администратора проверить email и ссылку.";
    }

    // Claim membership while the invite token is still in the callback URL.
    // This prevents a separate WhatsApp / email browser from losing the invite
    // before the protected page has a chance to load.
    async function claimInvitedWorkspace(sb, invite) {
        const { data: sessionData } = await sb.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) return { ok: false, reason: "UNAUTHENTICATED" };
        const endpoint = "/api/access/me" + (invite ? "?invite=" + encodeURIComponent(invite) : "");
        const response = await fetch(endpoint, {
            headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
            cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.access?.allowed) {
            return { ok: false, reason: data?.access?.reason || data?.reason || "UNKNOWN" };
        }
        if (invite) {
            try { localStorage.removeItem("sh_pending_invite"); } catch {}
        }
        return { ok: true, access: data.access };
    }

    async function clearWorkspaceSelection(sb) {
        try {
            const {data} = await sb.auth.getSession();
            const jwt = data?.session?.access_token;
            if (!jwt) return;
            await fetch('/api/access/workspaces', {
                method:'POST',
                headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
                body:JSON.stringify({action:'clear-selection'}),
                cache:'no-store'
            });
        } catch (_) { /* Logout must remain available even if API is offline. */ }
    }

    function invitationSignOut(sb, invite) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "auth-submit";
        btn.textContent = "Выйти и войти под приглашённым email";
        btn.onclick = async () => {
            await clearWorkspaceSelection(sb);
            await sb.auth.signOut();
            window.location.replace("register.html?invite=" + encodeURIComponent(invite));
        };
        document.querySelector(".auth-card")?.appendChild(btn);
    }

    function invitationPasswordPending(user) {
        return user?.user_metadata?.sh_invite_password_pending === true
            && user?.user_metadata?.sh_invite_password_initialized !== true;
    }

    function invitePasswordUrl() { return "/invite-password.html"; }

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
        showMessage("Сначала настройте Supabase в auth-config.js: укажите URL проекта и Publishable Key.", "error");
        return false;
    }

    async function createClient() {
        if (client) return client;
        if (!ready) return null;
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            throw new Error("Не удалось загрузить Supabase Auth.");
        }
        client = window.supabase.createClient(config.url, config.publishableKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
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
        // A newly invited OTP-only user must finish password setup before
        // the ordinary dashboard is displayed. No redirect on auth pages.
        if (invitationPasswordPending(user)) {
            window.location.replace(invitePasswordUrl());
            return;
        }
        window.SH_CURRENT_USER = user;
        document.documentElement.classList.add("auth-user-ready");
        document.dispatchEvent(new CustomEvent("sh-auth-ready", { detail: user }));
    }

    async function initLogin() {
        const invite = captureInvite();
        if (!requireConfigured()) return;
        const sb = await createClient();
        const user = await getUser();
        if (user) {
            if (invite) {
                const result = await claimInvitedWorkspace(sb, invite);
                if (!result.ok) {
                    showMessage(invitedUserMessage(result.reason), "error");
                    invitationSignOut(sb, invite);
                    return;
                }
            }
            window.location.replace(invitationPasswordPending(user) ? invitePasswordUrl() : redirectTarget());
            return;
        }
        const form = byId("login-form");
        if (!form) return;
        if (invite) {
            const preview = await invitePreview(invite);
            const emailInput = byId("login-email");
            if (preview?.email && emailInput && !emailInput.value) emailInput.value = preview.email;
            if (preview?.workspace?.name) showMessage("Приглашение в «" + preview.workspace.name + "». Войдите под указанным email.", "info");
        }
        form.addEventListener("submit", async event => {
            event.preventDefault(); showMessage("");
            const email = byId("login-email")?.value.trim();
            const password = byId("login-password")?.value || "";
            const button = form.querySelector("button[type=submit]");
            if (!email || !password) { showMessage("Введите email и пароль.", "error"); return; }
            setBusy(button, true, "Входим...");
            const { data, error } = await sb.auth.signInWithPassword({ email, password });
            setBusy(button, false);
            if (error) {
                const message = /email not confirmed/i.test(error.message) ? "Email ещё не подтверждён. Проверьте почту и перейдите по ссылке из письма." : "Не удалось войти. Проверьте email и пароль.";
                showMessage(message, "error"); return;
            }
            if (!data.user) { showMessage("Не удалось создать сессию.", "error"); return; }
            if (invite) {
                try {
                    const accepted = await claimInvitedWorkspace(sb, invite);
                    if (!accepted.ok) {
                        showMessage(invitedUserMessage(accepted.reason), "error");
                        return;
                    }
                } catch {
                    showMessage("Не удалось применить приглашение. Проверьте соединение и повторите вход.", "error");
                    return;
                }
            }
            window.location.replace(invitationPasswordPending(data.user) ? invitePasswordUrl() : redirectTarget());
        });
    }

    async function initRegister() {
        const invite = captureInvite();
        if (!requireConfigured()) return;
        const sb = await createClient();
        const existing = await getUser();
        if (invite) {
            const preview = await invitePreview(invite);
            if (!preview) {
                showMessage("Приглашение недействительно, истекло или уже использовано. Попросите администратора создать новую ссылку.", "error");
                byId("register-form").style.display = "none";
                return;
            }
            const form = byId("register-form");
            form.style.display = "none";
            const card = document.querySelector(".auth-card");
            const heading = card?.querySelector("h1");
            if (heading) heading.textContent = "Принять приглашение в Smart Horeca";
            const introduction = card?.querySelector("p.lead");
            if (introduction) introduction.textContent = "Для входа не нужно заново заполнять анкету или создавать пароль.";
            const info = document.createElement("p");
            info.className = "lead";
            info.textContent = "Приглашение в «" + (preview.workspace?.name || "Smart Horeca") + "» для " + preview.email + ". Отдельная регистрация и анкета сотрудника не нужны.";
            card.insertBefore(info, form);
            if (existing) {
                const accepted = await claimInvitedWorkspace(sb, invite);
                if (accepted.ok) {
                    window.location.replace(invitationPasswordPending(existing) ? invitePasswordUrl() : "index.html");
                    return;
                }
                showMessage(invitedUserMessage(accepted.reason), "error");
                invitationSignOut(sb, invite);
                return;
            }
            const btn = document.createElement("button");
            btn.className = "auth-submit";
            btn.type = "button";
            btn.textContent = "Подтвердить email и принять приглашение";
            card.insertBefore(btn, form);
            const note = document.createElement("p");
            note.className = "lead";
            note.textContent = "Отправим одно письмо для безопасного входа. После перехода по ссылке доступ к организации активируется автоматически. Если аккаунт уже существует, он будет использован.";
            card.insertBefore(note, form);
            btn.onclick = async () => {
                if (!preview.email) { showMessage("В приглашении не указан email.", "error"); return; }
                setBusy(btn, true, "Отправляем письмо...");
                const { error } = await sb.auth.signInWithOtp({
                    email: preview.email,
                    options: {
                        shouldCreateUser: true,
                        emailRedirectTo: inviteCallbackUrl(invite),
                        // Stored on newly created Supabase accounts. Existing users
                        // keep their own password and are not forcibly reset.
                        data: { sh_invite_password_pending: true }
                    }
                });
                setBusy(btn, false);
                if (error) { showMessage(error.message || "Не удалось отправить письмо для входа.", "error"); return; }
                showMessage("Письмо отправлено на " + preview.email + ". Перейдите по ссылке, и Smart Horeca автоматически привяжет аккаунт к приглашённой организации.", "success");
            };
            return;
        }
        if (existing) { window.location.replace("index.html"); return; }
        const form = byId("register-form");
        if (!form) return;
        if (invite) {
            const preview = await invitePreview(invite);
            const emailInput = byId("register-email");
            if (preview?.email && emailInput) {
                emailInput.value = preview.email;
                emailInput.readOnly = true;
            }
            if (preview?.workspace?.name) showMessage("Вас пригласили в «" + preview.workspace.name + "». Зарегистрируйтесь с указанным email.", "info");
        }
        form.addEventListener("submit", async event => {
            event.preventDefault(); showMessage("");
            const firstName = byId("register-first-name")?.value.trim();
            const lastName = byId("register-last-name")?.value.trim();
            const email = byId("register-email")?.value.trim().toLowerCase();
            const phone = byId("register-phone")?.value.trim();
            const password = byId("register-password")?.value || "";
            const password2 = byId("register-password2")?.value || "";
            const terms = byId("register-terms")?.checked;
            const button = form.querySelector("button[type=submit]");
            if (!firstName || !lastName || !email || !phone || !password || !password2) { showMessage("Заполните все поля.", "error"); return; }
            if (!terms) { showMessage("Подтвердите согласие с условиями использования.", "error"); return; }
            if (password.length < 8) { showMessage("Пароль должен содержать минимум 8 символов.", "error"); return; }
            if (password !== password2) { showMessage("Пароли не совпадают.", "error"); return; }
            setBusy(button, true, "Создаём аккаунт...");
            const redirectTo = `${window.location.origin}/auth-callback.html${invite ? '?invite=' + encodeURIComponent(invite) : ''}`;
            const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { first_name: firstName, last_name: lastName, phone } } });
            setBusy(button, false);
            if (error) { showMessage(error.message || "Не удалось зарегистрировать аккаунт.", "error"); return; }
            if (data.session) { window.location.replace("index.html"); return; }
            form.reset();
            showMessage(`Регистрация создана. Мы отправили письмо на ${email}. Подтвердите email, затем войдите в Smart Horeca.`, "success");
        });
    }

    async function initForgotPassword() {
        if (!requireConfigured()) return;
        const sb = await createClient();
        const form = byId("forgot-form");
        if (!form) return;
        form.addEventListener("submit", async event => {
            event.preventDefault(); showMessage("");
            const email = byId("forgot-email")?.value.trim().toLowerCase();
            const button = form.querySelector("button[type=submit]");
            if (!email) { showMessage("Введите email.", "error"); return; }
            setBusy(button, true, "Отправляем...");
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password.html` });
            setBusy(button, false);
            if (error) { showMessage(error.message || "Не удалось отправить письмо.", "error"); return; }
            showMessage("Если этот email зарегистрирован, письмо для восстановления уже отправлено.", "success");
        });
    }

    async function initResetPassword() {
        if (!requireConfigured()) return;
        const sb = await createClient();
        const form = byId("reset-form");
        if (!form) return;
        const { data: sessionData } = await sb.auth.getSession();
        if (!sessionData.session) { showMessage("Ссылка для восстановления недействительна или истекла. Запросите новое письмо.", "error"); return; }
        form.addEventListener("submit", async event => {
            event.preventDefault(); showMessage("");
            const password = byId("reset-password")?.value || "";
            const password2 = byId("reset-password2")?.value || "";
            const button = form.querySelector("button[type=submit]");
            if (password.length < 8) { showMessage("Пароль должен содержать минимум 8 символов.", "error"); return; }
            if (password !== password2) { showMessage("Пароли не совпадают.", "error"); return; }
            setBusy(button, true, "Сохраняем...");
            const { error } = await sb.auth.updateUser({ password });
            setBusy(button, false);
            if (error) { showMessage(error.message || "Не удалось изменить пароль.", "error"); return; }
            showMessage("Пароль изменён. Теперь можно войти в Smart Horeca.", "success");
            setTimeout(() => window.location.replace("index.html"), 1200);
        });
    }


    async function initInvitePassword() {
        if (!requireConfigured()) return;
        const sb = await createClient();
        const { data: sessionData } = await sb.auth.getSession();
        if (!sessionData?.session?.access_token) {
            showMessage("Сессия подтверждения email закончилась. Откройте ссылку из письма ещё раз или запросите восстановление доступа.", "error");
            return;
        }
        const { data: userData, error: userError } = await sb.auth.getUser();
        if (userError || !userData?.user) {
            showMessage("Не удалось подтвердить учётную запись. Повторите вход по ссылке.", "error");
            return;
        }
        const user = userData.user;
        if (!invitationPasswordPending(user)) {
            window.location.replace("index.html");
            return;
        }
        const email = byId("invite-password-email");
        if (email) email.textContent = user.email || "";
        const form = byId("invite-password-form");
        if (!form) return;
        form.addEventListener("submit", async event => {
            event.preventDefault();
            showMessage("");
            const password = byId("invite-password")?.value || "";
            const confirmation = byId("invite-password-confirm")?.value || "";
            if (password.length < 8) {
                showMessage("Пароль должен содержать минимум 8 символов.", "error");
                return;
            }
            if (password !== confirmation) {
                showMessage("Пароли не совпадают.", "error");
                return;
            }
            const button = form.querySelector("button[type=submit]");
            setBusy(button, true, "Сохраняем пароль...");
            try {
                const { error } = await sb.auth.updateUser({
                    password,
                    data: {
                        sh_invite_password_pending: false,
                        sh_invite_password_initialized: true
                    }
                });
                if (error) {
                    showMessage(error.message || "Не удалось сохранить пароль.", "error");
                    return;
                }
                // Never store the password in browser storage.
                if (byId("invite-password")) byId("invite-password").value = "";
                if (byId("invite-password-confirm")) byId("invite-password-confirm").value = "";
                showMessage("Пароль сохранён. В дальнейшем входите по email и этому паролю.", "success");
                window.location.replace("index.html");
            } catch (error) {
                showMessage(error?.message || "Ошибка сохранения пароля.", "error");
            } finally {
                setBusy(button, false);
            }
        });
    }

    async function initCallback() {
        const invite = captureInvite();
        if (!requireConfigured()) return;
        const sb = await createClient();
        showMessage("Подтверждаем email...", "info");
        const params = new URLSearchParams(window.location.search);
        const tokenHash = params.get("token_hash");
        const type = params.get("type");
        if (tokenHash && type) {
            const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
            if (error) { showMessage("Не удалось подтвердить email. Запросите новое письмо.", "error"); return; }
        }
        const { data } = await sb.auth.getSession();
        if (data.session) {
            showMessage("Email подтверждён. Проверяем приглашение в Smart Horeca...", "info");
            try {
                const result = await claimInvitedWorkspace(sb, invite);
                if (!result.ok) {
                    showMessage(invitedUserMessage(result.reason) + " Код: " + result.reason, "error");
                    return;
                }
            } catch (error) {
                showMessage("Не удалось завершить подключение к организации. Проверьте соединение и откройте исходную ссылку приглашения снова.", "error");
                return;
            }
            // The invitation has already been claimed and email verified.
            // Ask new passwordless users to create permanent credentials before
            // opening any protected page. Old accounts keep their password.
            if (invitationPasswordPending(data.session.user)) {
                showMessage("Email подтверждён. Теперь придумайте пароль для постоянного входа.", "success");
                window.location.replace(invitePasswordUrl());
                return;
            }
            showMessage("Готово! Доступ к Smart Horeca подтверждён.", "success");
            setTimeout(() => window.location.replace("index.html"), 500);
            return;
        }
        showMessage("Почта подтверждена, но сессия не была создана. Войдите под приглашённым email.", "info");
        const next = "login.html" + (invite ? "?invite=" + encodeURIComponent(invite) : "");
        setTimeout(() => window.location.replace(next), 1200);
    }

    async function initSiteAccess() {
        if (window.SHAccess?.load) return window.SHAccess.load();
        let script = document.getElementById("sh-site-access-script");
        if (!script) {
            script = document.createElement("script");
            script.id = "sh-site-access-script";
            script.src = "/site-access.js?v=20261009-invite-recovery-v1";
            document.head.appendChild(script);
        }
        await new Promise((resolve, reject) => {
            if (window.SHAccess?.load) { resolve(); return; }
            script.addEventListener("load", resolve, { once: true });
            script.addEventListener("error", () => reject(new Error("Не удалось загрузить права доступа.")), { once: true });
        });
        return window.SHAccess?.load?.();
    }

    async function initUserUI() {
        const user = window.SH_CURRENT_USER || await getUser();
        if (!user) return;
        const meta = user.user_metadata || {};
        // Site display name is owned by the Workspace invitation and can differ
        // from HR employee details and Supabase registration metadata.
        const displayName = String(window.SHAccess?.context?.displayName || "").trim();
        const name = displayName || [meta.first_name, meta.last_name].filter(Boolean).join(" ") || user.email || "Пользователь";
        document.querySelectorAll("[data-auth-name]").forEach(el => el.textContent = name);
        document.querySelectorAll("[data-auth-email]").forEach(el => el.textContent = user.email || "");
        document.querySelectorAll("[data-auth-avatar]").forEach(el => el.textContent = (displayName || meta.first_name || user.email || "S").charAt(0).toUpperCase());
        document.querySelectorAll("[data-auth-logout]").forEach(button => {
            button.addEventListener("click", async () => {
                await window.SHAuth.signOut();
            });
        });
    }

    async function initProtected() {
        await protectPage();
        await initSiteAccess();
        await initUserUI();
        setTimeout(() => {
            if (document.getElementById("pnl-nav-loader-script")) return;
            const s = document.createElement("script");
            s.id = "pnl-nav-loader-script";
            s.src = "pnl-nav-loader.js?v=20260907";
            document.body.appendChild(s);
        }, 700);
    }

    window.SHAuth = { createClient, getUser, protectPage, initUserUI, signOut: async function () { const sb = await createClient(); if (sb) { await clearWorkspaceSelection(sb); await sb.auth.signOut(); } window.location.replace("login.html"); } };

    document.addEventListener("DOMContentLoaded", async () => {
        const page = document.body.dataset.authPage || "";
        try {
            if (page === "login") await initLogin();
            else if (page === "register") await initRegister();
            else if (page === "forgot") await initForgotPassword();
            else if (page === "reset") await initResetPassword();
            else if (page === "invite-password") await initInvitePassword();
            else if (page === "callback") await initCallback();
            else if (document.body.dataset.protected === "true") await initProtected();
        } catch (error) {
            console.error("SH_Reports Auth error:", error);
            showMessage(error.message || "Ошибка авторизации.", "error");
        }
    });
})();
