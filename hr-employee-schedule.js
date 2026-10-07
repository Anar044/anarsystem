(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  var employeeId = new URLSearchParams(location.search).get("id") || "";
  var state = null;
  var busy = false;

  function today(){
    try { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baku",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
    catch(e){ return new Date().toISOString().slice(0,10); }
  }
  function modeText(x){
    if(!x) return "—";
    if(x.patternType === "CYCLE") return String(x.workDays||0)+"/"+String(x.offDays||0);
    var names={1:"Пн",2:"Вт",3:"Ср",4:"Чт",5:"Пт",6:"Сб",7:"Вс"};
    return (x.weekdays||[]).map(function(d){ return names[d]||d; }).join(", ") || "—";
  }
  async function token(){
    var client = await window.SHAuth?.createClient?.();
    if(!client) throw new Error("Supabase Auth не готов");
    var r = await client.auth.getSession();
    var t = r?.data?.session?.access_token;
    if(r?.error || !t) throw new Error("Сессия пользователя не найдена");
    return t;
  }
  async function api(path,options){
    var t=await token(), opt=Object.assign({},options||{});
    opt.headers=Object.assign({Authorization:"Bearer "+t,Accept:"application/json","Content-Type":"application/json"},opt.headers||{});
    var r = window.SH_IikoContext?.fetchWithTimeout
      ? await window.SH_IikoContext.fetchWithTimeout(path,opt,60000)
      : await fetch(path,opt);
    var j=await r.json().catch(function(){ return {success:false,message:"Некорректный ответ API"}; });
    if(!r.ok || j?.success===false) throw new Error(j?.message || ("HTTP "+r.status));
    return j;
  }
  function setStatus(text,kind){
    var el=$("hepScheduleOverrideStatus"); if(!el) return;
    el.textContent=text; el.className=("hr-status "+(kind||"")).trim();
  }
  function renderCurrent(){
    var host=$("hepScheduleContent"), badge=$("hepScheduleSource");
    if(!host) return;
    var current=state?.currentOverride, base=state?.roleDefault, x=current || base;
    if(!x){
      if(badge){ badge.textContent="Не настроено"; badge.className="hep-source"; }
      host.innerHTML='<div class="hep-placeholder"><div><strong>График не назначен</strong><p>Для должности сотрудника нет активного основного графика и нет индивидуального исключения.</p></div></div>';
      return;
    }
    var individual=!!current;
    if(badge){ badge.textContent=individual?"Индивидуальный":"По должности"; badge.className="hep-source "+(individual?"individual":"smart"); }
    var shift=(x.shiftStart||"—")+"–"+(x.shiftEnd||"—")+(x.breakMinutes?(" · перерыв "+x.breakMinutes+" мин"):"");
    var period=individual ? (x.effectiveFrom+" → "+(x.effectiveTo||"без ограничения")) : (x.validFrom+" → "+(x.validTo||"без ограничения"));
    host.innerHTML=
      '<div class="hep-schedule-current-note '+(individual?"individual":"role")+'">'+
        '<strong>'+(individual?"Индивидуальное исключение":"Основной график должности")+'</strong>'+
        '<span>'+(individual?"Имеет приоритет над графиком должности в своём периоде.":"Автоматически применяется ко всем сотрудникам этой должности без индивидуального исключения.")+'</span>'+
      '</div>'+
      '<div class="hep-schedule">'+
        '<div class="hep-schedule-cell"><span>Шаблон</span><strong>'+esc(x.scheduleName||x.name||"—")+'</strong></div>'+
        '<div class="hep-schedule-cell"><span>Режим</span><strong>'+esc(modeText(x))+'</strong></div>'+
        '<div class="hep-schedule-cell"><span>Смена</span><strong>'+esc(shift)+'</strong></div>'+
        '<div class="hep-schedule-cell"><span>Период</span><strong>'+esc(period)+'</strong></div>'+
      '</div>'+
      (individual && x.note ? '<div class="hep-schedule-override-period"><span>Комментарий</span><strong>'+esc(x.note)+'</strong></div>' : '');
  }
  function renderForm(){
    var select=$("hepScheduleOverrideSelect"); if(!select) return;
    var choices=state?.choices||[], base=state?.roleDefault;
    select.innerHTML = choices.length ? choices.map(function(x){
      return '<option value="'+esc(x.id)+'">'+esc(x.name)+' · '+esc(modeText(x))+(x.isDefault?" · основной":"")+'</option>';
    }).join("") : '<option value="">Нет активных шаблонов этой должности</option>';
    if(base && choices.some(function(x){return x.id===base.id;})) select.value=base.id;
    if($("hepScheduleOverrideFrom") && !$("hepScheduleOverrideFrom").value) $("hepScheduleOverrideFrom").value=today();
  }
  function renderAttendanceRule(){
    var rule=state?.attendanceRule||{},shift=rule.effectiveShiftType==="NIGHT"?"NIGHT":"DAY",source=rule.source==="EMPLOYEE"?"EMPLOYEE":"ROLE";
    if($("hepAttendanceNorm")) $("hepAttendanceNorm").textContent=((Number(rule.roleDailyNormMinutes||480)/60).toFixed(2).replace(/\.00$/,""))+" ч";
    if($("hepAttendanceShiftOverride")) $("hepAttendanceShiftOverride").value=rule.shiftTypeOverride||"";
    if($("hepAttendanceWindow")) $("hepAttendanceWindow").textContent=shift==="NIGHT"?"12:00 → 11:59 следующего дня":"05:00 → 04:59 следующего дня";
    var badge=$("hepAttendanceRuleSource");
    if(badge){ badge.textContent=source==="EMPLOYEE"?"Индивидуально":"По должности"; badge.className="hep-source "+(source==="EMPLOYEE"?"individual":"smart"); }
  }
  function renderHistory(){
    var host=$("hepScheduleOverrideHistory"); if(!host) return;
    var rows=state?.history||[], currentId=state?.currentOverride?.id||"";
    if(!rows.length){
      host.innerHTML='<div class="hep-pay-empty">Индивидуальных назначений нет. Сотрудник использует основной график должности.</div>';
      return;
    }
    host.innerHTML='<table class="hep-schedule-history-table"><thead><tr><th>Период</th><th>График</th><th>Режим</th><th>Смена</th><th>Комментарий</th><th>Статус</th><th></th></tr></thead><tbody>'+
      rows.map(function(x){
        return '<tr class="'+(x.id===currentId?"current":"")+'">'+
          '<td><strong>'+esc(x.effectiveFrom)+'</strong><span>'+esc(x.effectiveTo||"без ограничения")+'</span></td>'+
          '<td><strong>'+esc(x.scheduleName||"—")+'</strong></td>'+
          '<td>'+esc(modeText(x))+'</td>'+
          '<td>'+esc((x.shiftStart||"—")+"–"+(x.shiftEnd||"—"))+'</td>'+
          '<td>'+esc(x.note||"—")+'</td>'+
          '<td><span class="hep-pay-pill '+(x.id===currentId?"current":"")+'">'+(x.id===currentId?"Действует":"История")+'</span></td>'+
          '<td><button type="button" class="hr-link-button danger" data-schedule-remove="'+esc(x.id)+'">Удалить</button></td>'+
        '</tr>';
      }).join("")+
      '</tbody></table>';
  }
  function render(){ renderCurrent(); renderAttendanceRule(); renderForm(); renderHistory(); }
  async function load(){
    if(!employeeId || busy) return;
    try{
      busy=true; setStatus("Загрузка…","loading");
      state=await api("/api/hr/employee-schedule?id="+encodeURIComponent(employeeId));
      render(); setStatus("Готово","ok");
    }catch(e){
      console.error(e);
      if($("hepScheduleOverrideHistory")) $("hepScheduleOverrideHistory").innerHTML='<div class="hr-error">'+esc(e?.message||String(e))+'</div>';
      setStatus("Ошибка","error");
    }finally{ busy=false; }
  }
  async function saveAttendanceRule(){
    if(busy) return;
    var shiftTypeOverride=$("hepAttendanceShiftOverride")?.value||"";
    try{
      busy=true;
      if($("hepAttendanceRuleSave")) $("hepAttendanceRuleSave").disabled=true;
      setStatus("Сохраняем тип смены…","loading");
      await api("/api/hr/employee-schedule",{method:"POST",body:JSON.stringify({action:"saveAttendanceRule",employeeId:employeeId,shiftTypeOverride:shiftTypeOverride})});
      await loadForce();
      setStatus(shiftTypeOverride?"Индивидуальный тип смены сохранён":"Сотрудник наследует тип смены должности","ok");
    }catch(e){ console.error(e); setStatus(e?.message||"Ошибка","error"); }
    finally{ busy=false; if($("hepAttendanceRuleSave")) $("hepAttendanceRuleSave").disabled=false; }
  }
  async function save(){
    if(busy) return;
    var scheduleId=$("hepScheduleOverrideSelect")?.value||"", effectiveFrom=$("hepScheduleOverrideFrom")?.value||"", note=$("hepScheduleOverrideNote")?.value||"";
    if(!scheduleId || !effectiveFrom){ setStatus("Выберите график и дату","error"); return; }
    try{
      busy=true; if($("hepScheduleOverrideSave")) $("hepScheduleOverrideSave").disabled=true; setStatus("Сохраняем…","loading");
      await api("/api/hr/employee-schedule",{method:"POST",body:JSON.stringify({action:"saveOverride",employeeId:employeeId,scheduleId:scheduleId,effectiveFrom:effectiveFrom,note:note})});
      if($("hepScheduleOverrideNote")) $("hepScheduleOverrideNote").value="";
      await loadForce();
      setStatus("Индивидуальный график назначен","ok");
    }catch(e){ console.error(e); setStatus(e?.message||"Ошибка","error"); }
    finally{ busy=false; if($("hepScheduleOverrideSave")) $("hepScheduleOverrideSave").disabled=false; }
  }
  async function remove(overrideId){
    if(busy || !overrideId) return;
    if(!confirm("Удалить это индивидуальное назначение? Сотрудник снова будет использовать основной график должности.")) return;
    try{
      busy=true; setStatus("Удаляем…","loading");
      await api("/api/hr/employee-schedule",{method:"POST",body:JSON.stringify({action:"removeOverride",employeeId:employeeId,overrideId:overrideId})});
      await loadForce(); setStatus("Индивидуальное назначение удалено","ok");
    }catch(e){ console.error(e); setStatus(e?.message||"Ошибка","error"); }
    finally{ busy=false; }
  }
  async function loadForce(){
    var was=busy; busy=false;
    await load();
    busy=was;
  }
  function bind(){
    $("hepAttendanceRuleSave")?.addEventListener("click",saveAttendanceRule);
    $("hepAttendanceShiftOverride")?.addEventListener("change",function(){
      var shift=this.value || state?.attendanceRule?.roleShiftType || "DAY";
      if($("hepAttendanceWindow")) $("hepAttendanceWindow").textContent=shift==="NIGHT"?"12:00 → 11:59 следующего дня":"05:00 → 04:59 следующего дня";
    });
    $("hepScheduleOverrideSave")?.addEventListener("click",save);
    $("hepScheduleOverrideRefresh")?.addEventListener("click",loadForce);
    $("hepScheduleOverrideHistory")?.addEventListener("click",function(e){
      var b=e.target.closest("[data-schedule-remove]"); if(b) remove(b.dataset.scheduleRemove);
    });
  }
  function init(){ bind(); load(); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();