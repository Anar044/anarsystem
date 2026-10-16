(function(){
  "use strict";
  let timer=null,loading=false;
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmtTime=value=>{if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"medium"});};
  // Reuse the already authenticated SHAuth client. A second Supabase
  // client can compete for the same rotating refresh-token session.
  async function getAccessToken(){
    const client=await window.SHAuth?.createClient?.();
    if(!client)throw new Error("Авторизация Smart Horeca не готова.");
    const {data,error}=await client.auth.getSession();
    if(error||!data?.session?.access_token)
      throw new Error("Сессия истекла. Войдите в Smart Horeca заново.");
    return data.session.access_token;
  }
  async function fetchEvents(query,token){
    const url=`/api/plugin/events?${query}`;
    const response=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(
      url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"},30000);
    const result=await response.json().catch(()=>({}));
    return {response,result};
  }
  async function buildQuery(){const p=new URLSearchParams({limit:"100"});const event=$("event-filter").value.trim();const plugin=$("plugin-filter").value.trim();const manualDepartment=$("department-filter").value.trim();if(event)p.set("event",event);if(plugin)p.set("pluginId",plugin);let departments=[];try{departments=(await window.SH_IikoContext.getBinding()).departmentIds||[]}catch(_){}if(manualDepartment)p.set("departmentId",manualDepartment);else if(departments.length)p.set("departmentIds",departments.join(","));return p;}
  function render(events){$("event-count").textContent=events.length;$("plugin-count").textContent=new Set(events.map(e=>e.plugin_id).filter(Boolean)).size;$("department-count").textContent=new Set(events.map(e=>e.department_id).filter(Boolean)).size;$("last-event").textContent=events[0]?fmtTime(events[0].received_at):"—";if(!events.length){$("events-list").innerHTML='<div class="empty-note">Событий для подключённого iiko отдела пока нет.</div>';return;}$("events-list").innerHTML=events.map((e,i)=>{const payload=JSON.stringify(e.payload??{},null,2);return `<article class="event-row" data-index="${i}"><div class="event-main"><div class="event-time">${esc(fmtTime(e.received_at))}</div><div><div class="event-type">${esc(e.event_type||"Без типа")}</div><div class="event-meta">${e.plugin_id?`<span class="event-tag">${esc(e.plugin_id)}</span>`:""}${e.plugin_version?`<span class="event-tag muted">v${esc(e.plugin_version)}</span>`:""}${e.department_name?`<span class="event-tag muted">${esc(e.department_name)}</span>`:""}</div></div><button class="event-expand" type="button">Детали ↓</button></div><div class="event-details"><div class="event-grid"><div class="event-detail"><b>Event ID</b><span>${esc(e.event_id||"—")}</span></div><div class="event-detail"><b>Department ID</b><span>${esc(e.department_id||"—")}</span></div><div class="event-detail"><b>Event timestamp</b><span>${esc(fmtTime(e.event_timestamp))}</span></div><div class="event-detail"><b>Plugin</b><span>${esc(e.plugin_id||"—")}</span></div><div class="event-detail"><b>Server</b><span>${esc(e.server_url||"—")}</span></div><div class="event-detail"><b>Currency</b><span>${esc(e.currency_code||"—")}</span></div></div><pre class="payload">${esc(payload)}</pre></div></article>`;}).join("");document.querySelectorAll(".event-expand").forEach(btn=>btn.addEventListener("click",()=>{const row=btn.closest(".event-row");row.classList.toggle("open");btn.textContent=row.classList.contains("open")?"Скрыть ↑":"Детали ↓";}));}
  async function load(){
    if(loading)return;
    loading=true;
    const status=$("load-status"),live=$("live-status");
    live.classList.remove("paused");
    status.textContent="Обновляем…";
    try{
      const query=await buildQuery();
      let {response,result}=await fetchEvents(query,await getAccessToken());
      if(response.status===401){
        // One bounded refresh/retry; never spin at the 10-second polling rate.
        const client=await window.SHAuth?.createClient?.();
        const refreshed=client?await client.auth.refreshSession().catch(()=>null):null;
        const freshToken=refreshed?.data?.session?.access_token;
        if(freshToken)({response,result}=await fetchEvents(query,freshToken));
      }
      if(response.status===401){
        throw new Error("Журнал событий не подтверждает сессию (HTTP 401). "+
          "Если остальные разделы работают, проверьте авторизацию API /api/plugin/events.");
      }
      if(!response.ok||!result.success)
        throw new Error(result.error||`Ошибка журнала событий (HTTP ${response.status})`);
      render(result.events||[]);
      status.textContent=`Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;
    }catch(error){
      status.textContent="Ошибка загрузки — данные не получены";
      for(const id of ["event-count","plugin-count","department-count"])$(id).textContent="—";
      $("last-event").textContent="—";
      $("events-list").innerHTML=`<div class="error-note">${esc(error.message||"Не удалось загрузить события")}</div>`;
    }finally{loading=false;}
  }
  function schedule(){if(timer){clearInterval(timer);timer=null}const rate=Number($("refresh-rate").value);if(rate>0&&document.visibilityState!=="hidden")timer=setInterval(load,rate);$("live-status").classList.toggle("paused",rate===0||document.visibilityState==="hidden");}
  document.addEventListener("DOMContentLoaded",()=>{$("refresh-events").addEventListener("click",load);$("apply-filters").addEventListener("click",load);$("clear-filters").addEventListener("click",()=>{$("event-filter").value="";$("plugin-filter").value="";$("department-filter").value="";load();});$("refresh-rate").addEventListener("change",schedule);document.addEventListener("visibilitychange",schedule);["event-filter","plugin-filter","department-filter"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter")load();}));document.addEventListener("sh-auth-ready",load,{once:true});setTimeout(()=>{if(window.SH_CURRENT_USER)load();},500);schedule();});
})();
