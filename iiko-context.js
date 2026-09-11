(function () {
  "use strict";

  const SELECTION_KEY = "shIikoSelectedRestaurants";
  let promise = null;
  let cache = null;

  async function getClient() {
    if (!window.SHAuth?.createClient) throw new Error("SH Auth не готов");
    const client = await window.SHAuth.createClient();
    if (!client) throw new Error("Supabase Auth не настроен");
    return client;
  }

  async function load(force = false) {
    if (!force && promise) return promise;
    promise = (async () => {
      const client = await getClient();
      const { data, error } = await client.auth.getSession();
      const token = data?.session?.access_token;
      if (error || !token) throw new Error("Сессия пользователя не найдена");
      const response = await fetch("/api/iiko/state", {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.message || `iiko D1 HTTP ${response.status}`);
      cache = result?.state || null;
      normalizeSavedSelection(cache);
      return cache;
    })().catch(error => {
      cache = null;
      promise = null;
      throw error;
    });
    return promise;
  }

  function connection(state) { return state?.connection || null; }
  function identity(state) { return state?.identity || null; }

  function allRestaurantIds(state) {
    const id = identity(state);
    const conn = connection(state);
    const candidates = [
      ...(Array.isArray(id?.departments) ? id.departments.map(x => x?.id) : []),
      ...(Array.isArray(id?.departmentIds) ? id.departmentIds : []),
      ...(Array.isArray(id?.organizations) ? id.organizations.map(x => x?.id) : []),
      ...(Array.isArray(conn?.departments) ? conn.departments.map(x => x?.id) : []),
      ...(Array.isArray(conn?.departmentIds) ? conn.departmentIds : []),
      ...(Array.isArray(conn?.organizations) ? conn.organizations.map(x => x?.id) : []),
      id?.organizationId,
      conn?.organizationId
    ];
    return [...new Set(candidates.map(String).map(x => x.trim()).filter(x => x && x !== "undefined" && x !== "null"))];
  }

  function readSavedSelection() {
    try {
      const raw = localStorage.getItem(SELECTION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch (_) { return null; }
  }

  function writeSavedSelection(ids) {
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify([...new Set((ids || []).map(String))])); } catch (_) {}
  }

  function normalizeSavedSelection(state) {
    if (String(identity(state)?.mode || connection(state)?.connectionType || "RMS").toUpperCase() !== "CHAIN") return;
    const all = allRestaurantIds(state);
    const saved = readSavedSelection();
    if (!all.length) return;
    const valid = saved ? saved.filter(id => all.includes(String(id))) : [];
    writeSavedSelection(valid.length ? valid : all);
  }

  function departmentIds(state) {
    const id = identity(state);
    const conn = connection(state);
    const mode = String(id?.mode || conn?.connectionType || "RMS").toUpperCase();
    if (mode === "CHAIN") {
      const all = allRestaurantIds(state);
      const saved = readSavedSelection();
      const selected = saved ? saved.filter(x => all.includes(String(x))) : all;
      return selected.length ? selected : all;
    }

    const candidates = [
      ...(Array.isArray(id?.departmentIds) ? id.departmentIds : []),
      ...(Array.isArray(conn?.departmentIds) ? conn.departmentIds : []),
      ...(Array.isArray(id?.departments) ? id.departments.map(x => x?.id) : []),
      ...(Array.isArray(id?.organizations) ? id.organizations.map(x => x?.id) : []),
      ...(Array.isArray(conn?.organizations) ? conn.organizations.map(x => x?.id) : []),
      id?.organizationId,
      conn?.organizationId
    ];
    return [...new Set(candidates.map(String).map(x => x.trim()).filter(x => x && x !== "undefined" && x !== "null"))];
  }

  function restaurants(state) {
    const id = identity(state);
    const conn = connection(state);
    const source = Array.isArray(id?.organizations) && id.organizations.length
      ? id.organizations
      : (Array.isArray(id?.departments) && id.departments.length
        ? id.departments
        : (Array.isArray(conn?.organizations) ? conn.organizations : (Array.isArray(conn?.departments) ? conn.departments : [])));
    const seen = new Set();
    return source.map(x => ({ id: String(x?.id ?? ""), name: String(x?.name || x?.code || x?.id || "Ресторан") }))
      .filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
  }

  function setSelectedDepartmentIds(ids, options = {}) {
    const state = cache;
    if (!state) return [];
    const all = allRestaurantIds(state);
    const mode = String(identity(state)?.mode || connection(state)?.connectionType || "RMS").toUpperCase();
    if (mode !== "CHAIN") return all;
    const selected = [...new Set((ids || []).map(String))].filter(id => all.includes(id));
    writeSavedSelection(selected.length ? selected : all);
    const current = departmentIds(state);
    window.dispatchEvent(new CustomEvent("sh:iiko-selection-changed", { detail: { departmentIds: current, restaurants: restaurants(state) } }));
    if (!options.silent) window.dispatchEvent(new Event("sh:iiko-context-changed"));
    return current;
  }

  function injectRestaurantSelector() {
    if (document.body?.dataset.authPage) return;
    if (document.getElementById("sh-global-restaurant-filter")) return;
    if (!cache) return;
    const mode = String(identity(cache)?.mode || connection(cache)?.connectionType || "RMS").toUpperCase();
    if (mode !== "CHAIN") return;
    const list = restaurants(cache);
    if (!list.length) return;

    const style = document.createElement("style");
    style.id = "sh-global-restaurant-filter-style";
    style.textContent = `
      #sh-global-restaurant-filter{position:relative;display:flex;align-items:center;margin-left:auto;z-index:80;font-family:inherit}
      #sh-global-restaurant-filter .sh-rf-button{display:inline-flex;align-items:center;gap:8px;height:38px;min-width:176px;padding:0 11px;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(17,25,35,.82);color:#eef3f8;font:600 13px/1 inherit;cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.12);transition:.18s ease}
      #sh-global-restaurant-filter .sh-rf-button:hover,#sh-global-restaurant-filter.open .sh-rf-button{border-color:rgba(66,211,146,.38);background:#151e29;box-shadow:0 0 0 3px rgba(66,211,146,.06)}
      #sh-global-restaurant-filter .sh-rf-icon{width:24px;height:24px;display:grid;place-items:center;border-radius:7px;background:rgba(66,211,146,.11);color:#42d392;font-size:13px;flex:0 0 24px}
      #sh-global-restaurant-filter .sh-rf-label{color:#8f9bab;font-weight:500}
      #sh-global-restaurant-filter .sh-rf-count{color:#f1f5f9;font-weight:700}
      #sh-global-restaurant-filter .sh-rf-chevron{margin-left:auto;color:#8f9bab;font-size:12px;transition:transform .18s ease}
      #sh-global-restaurant-filter.open .sh-rf-chevron{transform:rotate(180deg)}
      #sh-global-restaurant-filter .sh-rf-menu{position:absolute;right:0;top:46px;width:306px;padding:10px;border:1px solid rgba(255,255,255,.11);border-radius:15px;background:#121923;box-shadow:0 20px 55px rgba(0,0,0,.45);display:none;overflow:hidden}
      #sh-global-restaurant-filter.open .sh-rf-menu{display:block;animation:shRfIn .14s ease-out}
      @keyframes shRfIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
      #sh-global-restaurant-filter .sh-rf-head{display:flex;align-items:center;justify-content:space-between;padding:3px 4px 10px}
      #sh-global-restaurant-filter .sh-rf-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8f9bab}
      #sh-global-restaurant-filter .sh-rf-status{font-size:11px;color:#42d392;font-weight:700}
      #sh-global-restaurant-filter .sh-rf-tools{display:flex;gap:6px;margin:0 0 7px}
      #sh-global-restaurant-filter .sh-rf-tools button{border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:6px 9px;background:#1a2430;color:#cfd8e2;font:600 11px/1 inherit;cursor:pointer}
      #sh-global-restaurant-filter .sh-rf-tools button:hover{background:#222e3b;border-color:rgba(66,211,146,.25)}
      #sh-global-restaurant-filter .sh-rf-list{max-height:270px;overflow:auto;padding-right:2px}
      #sh-global-restaurant-filter label{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:9px;color:#e9eef4;font-size:13px;cursor:pointer;transition:background .12s ease}
      #sh-global-restaurant-filter label:hover{background:rgba(255,255,255,.045)}
      #sh-global-restaurant-filter input{width:16px;height:16px;margin:0;accent-color:#42d392;cursor:pointer;flex:0 0 16px}
      #sh-global-restaurant-filter .sh-rf-actions{display:flex;gap:8px;padding-top:10px;margin-top:7px;border-top:1px solid rgba(255,255,255,.08)}
      #sh-global-restaurant-filter .sh-rf-actions button{flex:1;border:0;border-radius:9px;padding:9px 10px;background:#202b38;color:#dfe7ef;font:700 12px/1 inherit;cursor:pointer}
      #sh-global-restaurant-filter .sh-rf-actions button.primary{background:#42d392;color:#06110b}
      #sh-global-restaurant-filter .sh-rf-actions button.primary:hover{filter:brightness(1.05)}
      #sh-global-restaurant-filter .sh-rf-actions button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){#sh-global-restaurant-filter{margin-left:0}#sh-global-restaurant-filter .sh-rf-button{min-width:150px;max-width:190px}#sh-global-restaurant-filter .sh-rf-menu{position:fixed;right:12px;top:58px;width:min(306px,calc(100vw - 24px))}}
    `;
    document.head.appendChild(style);

    const selected = departmentIds(cache);
    const wrap = document.createElement("div");
    wrap.id = "sh-global-restaurant-filter";
    wrap.innerHTML = `
      <button type="button" class="sh-rf-button" aria-expanded="false" aria-haspopup="true">
        <span class="sh-rf-icon">⌘</span>
        <span class="sh-rf-label">Рестораны</span>
        <span class="sh-rf-count"></span>
        <span class="sh-rf-chevron">⌄</span>
      </button>
      <div class="sh-rf-menu" role="dialog" aria-label="Выбор ресторанов">
        <div class="sh-rf-head"><span class="sh-rf-title">Показать в отчётах</span><span class="sh-rf-status"></span></div>
        <div class="sh-rf-tools"><button type="button" data-rf-all>✓ Выбрать все</button><button type="button" data-rf-none>Снять все</button></div>
        <div class="sh-rf-list"></div>
        <div class="sh-rf-actions"><button type="button" data-rf-cancel>Отмена</button><button type="button" class="primary" data-rf-apply>Применить</button></div>
      </div>`;

    const listEl = wrap.querySelector(".sh-rf-list");
    list.forEach(r => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = r.id;
      checkbox.checked = selected.includes(r.id);
      const span = document.createElement("span");
      span.textContent = r.name;
      label.append(checkbox, span);
      listEl.appendChild(label);
    });

    const button = wrap.querySelector(".sh-rf-button");
    const countEl = wrap.querySelector(".sh-rf-count");
    const statusEl = wrap.querySelector(".sh-rf-status");
    const applyButton = wrap.querySelector("[data-rf-apply]");
    let appliedIds = [...selected];

    function updateCount() {
      const n = listEl.querySelectorAll("input:checked").length;
      countEl.textContent = n === list.length ? `все (${n})` : `${n} из ${list.length}`;
      statusEl.textContent = n === list.length ? "Все рестораны" : `${n} выбрано`;
      applyButton.disabled = n === 0;
    }

    function restoreApplied() {
      const valid = new Set(appliedIds);
      listEl.querySelectorAll("input").forEach(x => { x.checked = valid.has(x.value); });
      updateCount();
    }

    button.addEventListener("click", () => {
      const open = !wrap.classList.contains("open");
      wrap.classList.toggle("open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) restoreApplied();
    });
    wrap.querySelector("[data-rf-all]").addEventListener("click", () => {
      listEl.querySelectorAll("input").forEach(x => x.checked = true);
      updateCount();
    });
    wrap.querySelector("[data-rf-none]").addEventListener("click", () => {
      listEl.querySelectorAll("input").forEach(x => x.checked = false);
      updateCount();
    });
    wrap.querySelector("[data-rf-cancel]").addEventListener("click", () => {
      restoreApplied();
      wrap.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    });
    applyButton.addEventListener("click", () => {
      const ids = [...listEl.querySelectorAll("input:checked")].map(x => x.value);
      if (!ids.length) return;
      appliedIds = [...ids];
      setSelectedDepartmentIds(ids);
      wrap.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
      location.reload();
    });
    listEl.addEventListener("change", updateCount);
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) { wrap.classList.remove("open"); button.setAttribute("aria-expanded", "false"); } });
    updateCount();

    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.appendChild(wrap);
    else {
      const main = document.querySelector("main.main");
      if (main) main.insertBefore(wrap, main.firstElementChild || null);
    }
  }

  function server(state) { return identity(state)?.server || connection(state)?.server || null; }
  async function getConnection(force = false) { return connection(await load(force)); }
  async function getIdentity(force = false) { return identity(await load(force)); }
  async function getBinding(force = false) {
    const state = await load(force);
    return { departmentIds: departmentIds(state), allDepartmentIds: allRestaurantIds(state), restaurants: restaurants(state), server: server(state), connection: connection(state), identity: identity(state) };
  }

  window.SH_IikoContext = {
    load, get: load, getConnection, getIdentity, getBinding,
    departmentIds: state => departmentIds(state),
    allDepartmentIds: state => allRestaurantIds(state),
    restaurants: state => restaurants(state),
    getSelectedDepartmentIds: state => departmentIds(state),
    setSelectedDepartmentIds,
    getCached: () => cache
  };

  async function bootSelector() {
    try {
      const state = await load(false);
      if (state) injectRestaurantSelector();
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootSelector, { once: true });
  else bootSelector();
})();
