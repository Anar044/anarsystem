(function () {
  "use strict";

  const API = "/api/account/state";
  const IIKO_KEY = "iikoConnection";
  const IDENTITY_KEY = "iikoDepartmentIdentity";
  const MENU_KEY = "horeca_qr_menu_v1";
  const DESIGN_KEY = "horeca_qr_design_v1";
  const PUBLIC_KEY = "horeca_qr_public";
  let ready = false;
  let remoteFound = false;
  let applyingRemote = false;
  let lastSnapshot = "";
  let initialLocalHadData = false;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
  }

  function write(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (error) { console.warn("SH account local write failed", error); }
  }

  function currentUserReportsKey() {
    const user = window.SH_CURRENT_USER || {};
    return `SH_Reports.savedOlap.${user.id || user.email || "local"}`;
  }

  function localHasData() {
    const iiko = read(IIKO_KEY);
    const identity = read(IDENTITY_KEY);
    const menu = read(MENU_KEY);
    const reports = read(currentUserReportsKey());
    const pub = read(PUBLIC_KEY);
    return !!(iiko || identity || pub || (menu && (menu.categories?.length || menu.dishes?.length || menu.design)) || (Array.isArray(reports) && reports.length));
  }

  async function authHeaders() {
    try {
      if (!window.SHAuth?.createClient) return null;
      const client = await window.SHAuth.createClient();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return null;
      return { "Content-Type": "application/json", "Accept": "application/json", Authorization: `Bearer ${token}` };
    } catch (error) {
      console.warn("SH account auth token failed", error);
      return null;
    }
  }

  function buildState() {
    return {
      iikoConnection: read(IIKO_KEY),
      iikoDepartmentIdentity: read(IDENTITY_KEY),
      horecaQrPublic: read(PUBLIC_KEY),
      savedOlapReports: read(currentUserReportsKey()) || [],
      qr: read(DESIGN_KEY) || {},
      qrMenu: read(MENU_KEY) || null
    };
  }

  async function fetchPublishedMenu(publicId) {
    if (!publicId) return null;
    try {
      const response = await fetch(`/api/qr-menu/public?id=${encodeURIComponent(publicId)}`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || data.success === false || !data.menu) return null;
      return data;
    } catch (_) { return null; }
  }

  async function applyRemote(state) {
    if (!state || typeof state !== "object") return false;
    applyingRemote = true;
    try {
      if (state.iikoConnection) write(IIKO_KEY, state.iikoConnection);
      if (state.iikoDepartmentIdentity) write(IDENTITY_KEY, state.iikoDepartmentIdentity);
      if (state.horecaQrPublic) write(PUBLIC_KEY, state.horecaQrPublic);
      if (Array.isArray(state.savedOlapReports)) write(currentUserReportsKey(), state.savedOlapReports);
      if (state.qr && Object.keys(state.qr).length) write(DESIGN_KEY, state.qr);

      const publicId = state.horecaQrPublic?.publicId;
      const published = await fetchPublishedMenu(publicId);
      if (published?.menu) {
        const current = read(MENU_KEY) || {};
        const next = {
          ...current,
          categories: published.menu.categories || [],
          dishes: published.menu.dishes || [],
          active: published.menu.categories?.[0]?.id || current.active || "",
          design: published.design || current.design || {},
          source: "cloud-published",
          lastServerSync: published.updatedAt || new Date().toISOString()
        };
        write(MENU_KEY, next);
        write(DESIGN_KEY, published.design || current.design || {});
      } else if (state.qrMenu) {
        write(MENU_KEY, state.qrMenu);
      }
      return true;
    } finally {
      applyingRemote = false;
    }
  }

  async function loadRemote() {
    const headers = await authHeaders();
    if (!headers) return;
    const response = await fetch(API, { headers: { Accept: "application/json", Authorization: headers.Authorization } });
    if (!response.ok) throw new Error(`Account state HTTP ${response.status}`);
    const data = await response.json();
    remoteFound = !!data.found;
    if (data.found && data.state && !initialLocalHadData) {
      await applyRemote(data.state);
      setTimeout(() => location.reload(), 250);
      return;
    }
    if (!data.found && initialLocalHadData) await saveRemote();
  }

  async function saveRemote() {
    if (applyingRemote || !ready) return;
    const headers = await authHeaders();
    if (!headers) return;
    const state = buildState();
    const snapshot = JSON.stringify(state);
    if (snapshot === lastSnapshot) return;
    const response = await fetch(API, { method: "POST", headers, body: JSON.stringify({ state }) });
    if (!response.ok) throw new Error(`Account state save HTTP ${response.status}`);
    lastSnapshot = snapshot;
    remoteFound = true;
  }

  async function sync() {
    try {
      await loadRemote();
    } catch (error) {
      console.warn("SH account cloud sync load failed", error);
    }
    ready = true;
    lastSnapshot = JSON.stringify(buildState());
  }

  async function init() {
    initialLocalHadData = localHasData();
    await sync();
    if (!ready) return;
    setInterval(async () => {
      if (!remoteFound && !localHasData()) return;
      try { await saveRemote(); } catch (error) { console.warn("SH account cloud sync save failed", error); }
    }, 3000);
  }

  window.SHAccount = {
    ready: init(),
    load: loadRemote,
    save: saveRemote,
    getState: buildState
  };
})();
