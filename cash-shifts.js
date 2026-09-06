(function(){
  const $ = id => document.getElementById(id);
  const connectionKey = "iikoConnection";
  const api = "/api/iiko/cash-shifts";

  function installStyles(){
    if(document.getElementById("cash-shifts-runtime-style")) return;
    const style=document.createElement("style");
    style.id="cash-shifts-runtime-style";
    style.textContent=`
      .cash-shifts-page{padding:24px;max-width:1650px;margin:0 auto;box-sizing:border-box}
      .cs-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:18px}
      .cs-kicker{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#42d392;margin-bottom:7px}
      .cs-title{margin:0;color:#f4f7fa;font-size:27px;line-height:1.15}.cs-sub{margin:7px 0 0;color:#8994a3;font-size:12px}
      .cs-panel{background:#111923;border:1px solid #222c38;border-radius:14px;padding:17px;margin-bottom:14px;box-sizing:border-box}
      .cs-filters{display:grid;grid-template-columns:180px 180px 1fr auto;gap:10px;align-items:end}.cs-field{display:flex;flex-direction:column;gap:6px}.cs-field label{font-size:10px;color:#8994a3;font-weight:700}.cs-field input{height:38px;box-sizing:border-box;border:1px solid #293442;background:#0e151d;color:#f4f7fa;border-radius:9px;padding:8px 10px;width:100%}
      .cs-btn{height:38px;border:0;border-radius:9px;padding:0 16px;background:#42d392;color:#06110b;font-weight:800;cursor:pointer}.cs-btn:disabled{opacity:.5;cursor:wait}
      .cs-status{font-size:10px;color:#8994a3;min-height:16px;margin-top:10px}.cs-status.error{color:#ff6678}.cs-status.ok{color:#42d392}
      .cs-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.cs-stat{background:#111923;border:1px solid #222c38;border-radius:12px;padding:14px}.cs-stat span{display:block;color:#8994a3;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;margin-bottom:7px}.cs-stat strong{font-size:20px;color:#f4f7fa}.cs-stat small{display:block;margin-top:4px;color:#6f7c8b;font-size:9px}
      .cs-table-wrap{overflow:auto;border:1px solid #222c38;border-radius:12px;background:#0f171f}.cs-table{width:100%;min-width:900px;border-collapse:collapse;font-size:10px}.cs-table th{text-align:left;padding:10px;background:#111923;color:#6f7c8b;text-transform:uppercase;letter-spacing:.05em;font-size:8px;white-space:nowrap}.cs-table td{padding:10px;border-top:1px solid #1d2732;color:#dce4eb;white-space:nowrap}.cs-table tbody tr:hover{background:#121d26}.cs-empty{text-align:center;padding:38px;color:#6f7c8b;font-size:11px}.cs-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:800}.cs-open{background:#382f18;color:#ffb454}.cs-closed{background:#15251f;color:#42d392}
      .cs-errors{margin-top:10px;padding:10px;border:1px solid #3a2830;border-radius:9px;background:#171116;color:#ff9aa6;font-size:10px;line-height:1.5}.cs-errors b{color:#ff6678}.cs-debug{margin-top:8px;color:#8994a3;font-size:9px}
      @media(max-width:900px){.cs-filters{grid-template-columns:1fr 1fr}.cs-filters .cs-btn{grid-column:1/-1}.cs-stats{grid-template-columns:1fr 1fr}}
      @media(max-width:760px){.cash-shifts-page{padding:18px 14px 34px}.cs-head{align-items:flex-start;flex-direction:column}.cs-title{font-size:23px}.cs-panel{padding:14px}}
      @media(max-width:480px){.cs-filters,.cs-stats{grid-template-columns:1fr}.cs-filters .cs-btn{grid-column:auto}.cs-table{min-width:820px}}
    `;
    document.head.appendChild(style);
  }

  function pad(n){ return String(n).padStart(2,"0"); }
  function localDate(offset){ const d=new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function money(value){ const n=Number(value); return Number.isFinite(n) ? n.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"; }
  function pick(o,keys,fallback=""){ for(const k of keys){ if(o&&o[k]!==undefined&&o[k]!==null&&o[k]!=="") return o[k]; } return fallback; }
  function formatDateTime(v){ if(!v)return "—"; return String(v).replace("T"," ").replace(/\.\d{1,6}(?=Z|$)/,"").replace("Z",""); }
  function getConnection(){ try{return JSON.parse(localStorage.getItem(connectionKey)||"null");}catch{return null;} }
  function isOpen(s){ const status=String(pick(s,["status","state","sessionStatus"],"")).toUpperCase(); if(status.includes("OPEN"))return true; return !pick(s,["closeDate","closedAt","closeTime","endDate","endTime"],""); }
  function salesValue(s){ return pick(s,["sum","salesSum","sales","revenue","totalSales","sumSales","salesAmount"],null); }
  function cashName(s){ return pick(s,["cashRegisterName","cashRegister","registerName","cashRegisterNumber","number"],"—"); }
  function operator(s){ return pick(s,["cashierName","cashier","operatorName","employeeName","responsibleCashier"],"—"); }
  function shiftNumber(s){ return pick(s,["shiftNumber","number","sessionNumber","cashShiftNumber"],"—"); }
  function openTime(s){ return pick(s,["openDate","openedAt","openTime","startDate","startTime"],""); }
  function closeTime(s){ return pick(s,["closeDate","closedAt","closeTime","endDate","endTime"],""); }
  function businessDate(s){ return pick(s,["date","businessDate","openDate","operatingDay","operationalDay","_requestedDate"],"—"); }
  function setStatus(text,type=""){ const el=$("cs-status"); el.textContent=text; el.className=`cs-status ${type}`; }
  function escapeHtml(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));}

  function render(shifts){
    const total=shifts.length, open=shifts.filter(isOpen).length, closed=total-open;
    const sales=shifts.reduce((sum,s)=>{const n=Number(salesValue(s));return Number.isFinite(n)?sum+n:sum;},0);
    $("cs-total").textContent=total; $("cs-open").textContent=open; $("cs-closed").textContent=closed; $("cs-sales").textContent=sales?money(sales):"—";
    if(!total){$("cs-table-wrap").innerHTML='<div class="cs-empty">За выбранный период кассовые смены не найдены.</div>';return;}
    const rows=shifts.map(s=>{const opened=openTime(s),closedAt=closeTime(s),openState=isOpen(s),sale=salesValue(s);return `<tr><td>${escapeHtml(businessDate(s))}</td><td>${escapeHtml(cashName(s))}</td><td>${escapeHtml(shiftNumber(s))}</td><td>${escapeHtml(formatDateTime(opened))}</td><td>${escapeHtml(formatDateTime(closedAt))}</td><td>${escapeHtml(operator(s))}</td><td>${sale==null?"—":money(sale)}</td><td><span class="cs-badge ${openState?'cs-open':'cs-closed'}">${openState?'Открыта':'Закрыта'}</span></td></tr>`;}).join("");
    $("cs-table-wrap").innerHTML=`<table class="cs-table"><thead><tr><th>Опер. день</th><th>Касса</th><th>№ смены</th><th>Открыта</th><th>Закрыта</th><th>Отв. кассир</th><th>Продажи</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function load(){
    const conn=getConnection();
    if(!conn||!conn.ip||!conn.port||!conn.login||!conn.password){setStatus("Нет сохранённого подключения к SH Server. Сначала подключите сервер в Настройках.","error");return;}
    const from=$("cs-from").value,to=$("cs-to").value;
    if(!from||!to){setStatus("Выберите период.","error");return;}
    const btn=$("cs-load");btn.disabled=true;$("cs-table-wrap").innerHTML='<div class="cs-empty">Загрузка смен...</div>';setStatus("Получаем кассовые смены из SH Server…");
    try{
      const res=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip:conn.ip,port:conn.port,login:conn.login,password:conn.password,from,to})});
      const data=await res.json().catch(()=>({success:false,message:"Некорректный ответ сервера"}));
      if(!res.ok||!data.success)throw new Error(data.message||`HTTP ${res.status}`);
      render(Array.isArray(data.shifts)?data.shifts:[]);
      if(Array.isArray(data.errors)&&data.errors.length){
        const first=data.errors[0];
        setStatus(`Загружено ${data.count||0} смен. Ошибок дат: ${data.errors.length}.`,"error");
        const box=document.createElement("div");box.className="cs-errors";box.innerHTML=`<b>iiko не принял запрос для ${escapeHtml(first.date||"даты")}</b>: HTTP ${escapeHtml(first.status||"")} — ${escapeHtml(first.message||"без текста")}${data.dateFormatsTried?`<div class="cs-debug">Проверены форматы: ${escapeHtml(data.dateFormatsTried.join(", "))}</div>`:""}`;$("cs-table-wrap").appendChild(box);
      }else setStatus(`Загружено ${data.count||0} кассовых смен.`,"ok");
    }catch(e){render([]);setStatus(e.message||"Ошибка получения смен","error");}finally{btn.disabled=false;}
  }

  document.addEventListener("DOMContentLoaded",()=>{installStyles();const today=localDate(0),weekAgo=localDate(-6);$("cs-from").value=weekAgo;$("cs-to").value=today;$("cs-load").addEventListener("click",load);});
})();
