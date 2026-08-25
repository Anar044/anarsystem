(function(){
  "use strict";

  let timer = null;
  let loading = false;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmtTime = value => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ru-RU", {dateStyle:"short", timeStyle:"medium"});
  };
  const short = (value, n=42) => { const s=String(value ?? ""); return s.length>n ? `${s.slice(0,n)}…` : s; };

  async function getAccessToken(){
    const config = window.SH_AUTH_CONFIG || {};
    if (!window.supabase || !config.url || !config.publishableKey) throw new Error("Supabase Auth не настроен");
    if (!window.__SH_EVENTS_CLIENT) window.__SH_EVENTS_CLIENT = window.supabase.createClient(config.url, config.publishableKey);
    const {data, error} = await window.__SH_EVENTS_CLIENT.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Сессия не найдена. Войдите заново.");
    return data.session.access_token;
  }

  function buildQuery(){
    const p = new URLSearchParams({limit:"100"});
    const event = $("event-filter").value.trim();
    const plugin = $("plugin-filter").value.trim();
    const department = $("department-filter").value.trim();
    if(event) p.set("event",event);
    if(plugin) p.set("pluginId",plugin);
    if(department) p.set("departmentId",department);
    return p;
  }

  function render(events){
    $("event-count").textContent = events.length;
    const plugins = new Set(events.map(e=>e.plugin_id).filter(Boolean));
    const departments = new Set(events.map(e=>e.department_id).filter(Boolean));
    $("plugin-count").textContent = plugins.size;
    $("department-count").textContent = departments.size;
    $("last-event").textContent = events[0] ? fmtTime(events[0].received_at) : "—";

    if(!events.length){
      $("events-list").innerHTML = '<div class="empty-note">Пока событий нет. Отправь тестовый event через <code>/api/plugin/ingest</code>.</div>';
      return;
    }

    $("events-list").innerHTML = events.map((e, i) => {
      const payload = JSON.stringify(e.payload ?? {}, null, 2);
      return `<article class="event-row" data-index="${i}">
        <div class="event-main">
          <div class="event-time">${esc(fmtTime(e.received_at))}</div>
          <div><div class="event-type">${esc(e.event_type || "Без типа")}</div><div class="event-meta">
            ${e.plugin_id ? `<span class="event-tag">${esc(e.plugin_id)}</span>` : ""}
            ${e.plugin_version ? `<span class="event-tag muted">v${esc(e.plugin_version)}</span>` : ""}
            ${e.department_name ? `<span class="event-tag muted">${esc(e.department_name)}</span>` : ""}
          </div></div>
          <button class="event-expand" type="button">Детали ↓</button>
        </div>
        <div class="event-details"><div class="event-grid">
          <div class="event-detail"><b>Event ID</b><span>${esc(e.event_id || "—")}</span></div>
          <div class="event-detail"><b>Department ID</b><span>${esc(e.department_id || "—")}</span></div>
          <div class="event-detail"><b>Event timestamp</b><span>${esc(fmtTime(e.event_timestamp))}</span></div>
          <div class="event-detail"><b>Plugin</b><span>${esc(e.plugin_id || "—")}</span></div>
          <div class="event-detail"><b>Server</b><span>${esc(e.server_url || "—")}</span></div>
          <div class="event-detail"><b>Currency</b><span>${esc(e.currency_code || "—")}</span></div>
        </div><pre class="payload">${esc(payload)}</pre></div>
      </article>`;
    }).join("");

    document.querySelectorAll(".event-expand").forEach(btn=>btn.addEventListener("click",()=>{
      const row=btn.closest(".event-row"); row.classList.toggle("open"); btn.textContent=row.classList.contains("open")?"Скрыть ↑":"Детали ↓";
    }));
  }

  async function load(){
    if(loading) return;
    loading=true;
    const status=$("load-status");
    const live=$("live-status");
    live.classList.remove("paused");
    status.textContent="Обновляем…";
    try{
      const token=await getAccessToken();
      const response=await fetch(`/api/plugin/events?${buildQuery()}`,{headers:{Authorization:`Bearer ${token}`}});
      const result=await response.json();
      if(!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
      render(result.events || []);
      status.textContent=`Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;
    }catch(error){
      status.textContent="Ошибка загрузки";
      $("events-list").innerHTML=`<div class="error-note">${esc(error.message || "Не удалось загрузить события")}</div>`;
    }finally{loading=false;}
  }

  function schedule(){
    if(timer) clearInterval(timer);
    const rate=Number($("refresh-rate").value);
    if(rate>0) timer=setInterval(load,rate);
    $("live-status").classList.toggle("paused",rate===0);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    $("refresh-events").addEventListener("click",load);
    $("apply-filters").addEventListener("click",load);
    $("clear-filters").addEventListener("click",()=>{ $("event-filter").value=""; $("plugin-filter").value=""; $("department-filter").value=""; load(); });
    $("refresh-rate").addEventListener("change",schedule);
    ["event-filter","plugin-filter","department-filter"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter") load();}));
    document.addEventListener("sh-auth-ready",load,{once:true});
    setTimeout(()=>{ if(window.SH_CURRENT_USER) load(); },500);
    schedule();
  });
})();
