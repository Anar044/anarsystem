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
    const source = Array.isArray(id?.departments) && id.departments.length
      ? id.departments
      : (Array.isArray(id?.organizations) ? id.organizations : (Array.isArray(conn?.departments) ? conn.departments : []));
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
      #sh-global-restaurant-filter{position:relative;display:flex;align-items:center;gap:8px;margin-left:auto;z-index:80}
      #sh-global-restaurant-filter .sh-rf-button{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.045);color:#eef3f8;font:600 13px/1 inherit;cursor:pointer;white-space:nowrap}
      #sh-global-restaurant-filter .sh-rf-button:hover{background:rgba(255,255,255,.08)}
      #sh-global-restaurant-filter .sh-rf-menu{position:absolute;right:0;top:44px;width:280px;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#121923;box-shadow:0 18px 45px rgba(0,0,0,.38);display:none}
      #sh-global-restaurant-filter.open .sh-rf-menu{display:block}
      #sh-global-restaurant-filter .sh-rf-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8f9bab;padding:3px 4px 9px}
      #sh-global-restaurant-filter label{display:flex;align-items:center;gap:9px;padding:9px 7px;border-radius:8px;color:#e9eef4;font-size:13px;cursor:pointer}
      #sh-global-restaurant-filter label:hover{background:rgba(255,255,255,.05)}
      #sh-global-restaurant-filter input{accent-color:#42d392}
      #sh-global-restaurant-filter .sh-rf-actions{display:flex;gap:7px;padding-top:8px;margin-top:5px;border-top:1px solid rgba(255,255,255,.08)}
      #sh-global-restaurant-filter .sh-rf-actions button{flex:1;border:0;border-radius:8px;padding:8px 9px;background:#202b38;color:#dfe7ef;font:600 12px/1 inherit;cursor:pointer}
      #sh-global-restaurant-filter .sh-rf-actions button.primary{background:#42d392;color:#06110b}
      @media(max-width:760px){#sh-global-restaurant-filter{margin-left:0}#sh-global-restaurant-filter .sh-rf-button{max-width:180px;overflow:hidden;text-overflow:ellipsis}#sh-global-restaurant-filter .sh-rf-menu{position:fixed;right:12px;top:58px;width:min(300px,calc(100vw - 24px))}}
    `;
    document.head.appendChild(style);

    const selected = departmentIds(cache);
    const wrap = document.createElement("div");
    wrap.id = "sh-global-restaurant-filter";
    wrap.innerHTML = `<button type="button" class="sh-rf-button" aria-expanded="false">Рестораны: <span class="sh-rf-count"></span>⌄</button><div class="sh-rf-menu"><div class="sh-rf-title">Показать в отчётах</div><div class="sh-rf-list"></div><div class="sh-rf-actions"><button type="button" data-rf-all>Все</button><button type="button" class="primary" data-rf-apply>Применить</button></div></div>`;
    const listEl = wrap.querySelector(".sh-rf-list");
    list.forEach(r => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" value="${r.id.replace(/"/g, "&quot;")}" ${selected.includes(r.id) ? "checked" : ""}><span>${r.name.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</span>`;
      listEl.appendChild(label);
    });
    const button = wrap.querySelector(".sh-rf-button");
    const menu = wrap.querySelector(".sh-rf-menu");
    const countEl = wrap.querySelector(".sh-rf-count");
    function updateCount() {
      const n = listEl.querySelectorAll("input:checked").length;
      countEl.textContent = n === list.length ? `все (${n}) ` : `${n} из ${list.length} `;
    }
    button.addEventListener("click", () => { wrap.classList.toggle("open"); button.setAttribute("aria-expanded", wrap.classList.contains("open") ? "true" : "false"); });
    wrap.querySelector("[data-rf-all]").addEventListener("click", () => { listEl.querySelectorAll("input").forEach(x => x.checked = true); updateCount(); });
    wrap.querySelector("[data-rf-apply]").addEventListener("click", () => {
      const ids = [...listEl.querySelectorAll("input:checked")].map(x => x.value);
      setSelectedDepartmentIds(ids);
      wrap.classList.remove("open");
      location.reload();
    });
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) wrap.classList.remove("open"); });
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
