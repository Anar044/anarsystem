(function(){
  const $ = id => document.getElementById(id);
  const connectionKey = "iikoConnection";
  const api = "/api/iiko/cash-shifts";

  function pad(n){ return String(n).padStart(2,"0"); }
  function localDate(offset){
    const d = new Date(); d.setDate(d.getDate()+offset);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function money(value){
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  }
  function pick(o, keys, fallback=""){
    for(const k of keys){ if(o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; }
    return fallback;
  }
  function formatDateTime(v){
    if(!v) return "—";
    const s=String(v).replace("T"," ").replace(/\.\d{1,6}(?=Z|$)/,"");
    return s.replace("Z","");
  }
  function getConnection(){
    try{return JSON.parse(localStorage.getItem(connectionKey)||"null");}catch{return null;}
  }
  function isOpen(s){
    const status=String(pick(s,["status","state","sessionStatus"],"")).toUpperCase();
    if(status.includes("OPEN")) return true;
    const closed=pick(s,["closeDate","closedAt","closeTime","endDate","endTime"],"");
    return !closed;
  }
  function salesValue(s){
    return pick(s,["sum","salesSum","sales","revenue","totalSales","sumSales","salesAmount"],null);
  }
  function cashName(s){ return pick(s,["cashRegisterName","cashRegister","registerName","cashRegisterNumber","number"],"—"); }
  function operator(s){ return pick(s,["cashierName","cashier","operatorName","employeeName","responsibleCashier"],"—"); }
  function shiftNumber(s){ return pick(s,["shiftNumber","number","sessionNumber","cashShiftNumber"],"—"); }
  function openTime(s){ return pick(s,["openDate","openedAt","openTime","startDate","startTime"],""); }
  function closeTime(s){ return pick(s,["closeDate","closedAt","closeTime","endDate","endTime"],""); }
  function businessDate(s){ return pick(s,["date","businessDate","openDate","operatingDay","operationalDay"],"—"); }

  function setStatus(text,type=""){ const el=$("cs-status"); el.textContent=text; el.className=`cs-status ${type}`; }

  function render(shifts){
    const total=shifts.length;
    const open=shifts.filter(isOpen).length;
    const closed=total-open;
    const sales=shifts.reduce((sum,s)=>{const n=Number(salesValue(s));return Number.isFinite(n)?sum+n:sum;},0);
    $("cs-total").textContent=total;
    $("cs-open").textContent=open;
    $("cs-closed").textContent=closed;
    $("cs-sales").textContent=sales ? money(sales) : "—";

    if(!total){ $("cs-table-wrap").innerHTML='<div class="cs-empty">За выбранный период кассовые смены не найдены.</div>'; return; }
    const rows=shifts.map(s=>{
      const opened=openTime(s), closedAt=closeTime(s), openState=isOpen(s);
      const sale=salesValue(s);
      return `<tr>
        <td>${escapeHtml(businessDate(s))}</td>
        <td>${escapeHtml(cashName(s))}</td>
        <td>${escapeHtml(shiftNumber(s))}</td>
        <td>${escapeHtml(formatDateTime(opened))}</td>
        <td>${escapeHtml(formatDateTime(closedAt))}</td>
        <td>${escapeHtml(operator(s))}</td>
        <td>${sale==null?"—":money(sale)}</td>
        <td><span class="cs-badge ${openState?'cs-open':'cs-closed'}">${openState?'Открыта':'Закрыта'}</span></td>
      </tr>`;
    }).join("");
    $("cs-table-wrap").innerHTML=`<table class="cs-table"><thead><tr><th>Опер. день</th><th>Касса</th><th>№ смены</th><th>Открыта</th><th>Закрыта</th><th>Отв. кассир</th><th>Продажи</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function escapeHtml(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));}

  async function load(){
    const conn=getConnection();
    if(!conn || !conn.ip || !conn.port || !conn.login || !conn.password){
      setStatus("Нет сохранённого подключения к SH Server. Сначала подключите сервер в Настройках.","error");
      return;
    }
    const from=$("cs-from").value, to=$("cs-to").value;
    if(!from||!to){setStatus("Выберите период.","error");return;}
    const btn=$("cs-load"); btn.disabled=true; setStatus("Получаем кассовые смены из iiko Server…");
    try{
      const res=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ip:conn.ip,port:conn.port,login:conn.login,password:conn.password,from,to})});
      const data=await res.json().catch(()=>({success:false,message:"Некорректный ответ сервера"}));
      if(!res.ok||!data.success) throw new Error(data.message||`HTTP ${res.status}`);
      render(Array.isArray(data.shifts)?data.shifts:[]);
      if(Array.isArray(data.errors)&&data.errors.length) setStatus(`Загружено ${data.count||0} смен. Не удалось получить ${data.errors.length} дат.`,`error`);
      else setStatus(`Загружено ${data.count||0} кассовых смен.`,`ok`);
    }catch(e){
      render([]); setStatus(e.message||"Ошибка получения смен","error");
    }finally{btn.disabled=false;}
  }

  document.addEventListener("DOMContentLoaded",()=>{
    const today=localDate(0), weekAgo=localDate(-6);
    $("cs-from").value=weekAgo; $("cs-to").value=today;
    $("cs-load").addEventListener("click",load);
  });
})();
