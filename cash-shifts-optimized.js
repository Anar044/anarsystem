(function(){
const $=id=>document.getElementById(id),API="/api/iiko/finance-data",pad=n=>String(n).padStart(2,"0");
function day(n){const d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function add(v,n){const d=new Date(v+"T00:00:00");d.setDate(d.getDate()+n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function money(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]))}
function v(o,k,f=null){return o&&o[k]!==undefined&&o[k]!==null&&o[k]!==""?o[k]:f}
function first(o,keys,f=""){for(const k of keys){const x=o?.[k];if(x!==undefined&&x!==null&&String(x).trim()!=="")return x}return f}
function departmentId(s){return String(first(s,["_departmentId","departmentId","departmentID","departmentGuid","organizationId","organisationId","restaurantId"],s?.department?.id??s?.organization?.id??s?.restaurant?.id??"")).trim()}
function normId(x){return String(x??"").trim().replace(/^\\{+|\\}+$/g,"").toLowerCase()}
function cashRegisterName(s){return String(first(s,["cashRegisterName","cashRegName","cashDeskName","registerName","terminalName","fiscalRegisterName"],"")).trim()}
function cashierName(s){return String(first(s,["responsibleUserName","cashierName","responsibleCashierName","userName","employeeName"],"")).trim()}
async function getIikoBinding(){if(window.SH_IikoContext?.getBinding)return await window.SH_IikoContext.getBinding();const state=window.SH_IikoContext?.get?await window.SH_IikoContext.get():null;return{connection:state?.connection||null,departmentIds:window.SH_IikoContext?.departmentIds?window.SH_IikoContext.departmentIds(state):[]}}
function open(s){return !v(s,"closeDate",null)||String(v(s,"sessionStatus","")).toUpperCase()==="OPEN"}
function totals(shifts){return shifts.reduce((a,s)=>{a.sales+=Number(v(s,"payOrders",0))||0;return a},{sales:0})}
const paymentNames={CARD:"Безналичные",PAYIN:"Внесения",PAYOUT:"Изъятия"};
function paymentHtml(s,index){const ps=Array.isArray(s._payments)?s._payments:[],id=`payment-${index}`;if(!ps.length)return`<span class="cs-payment-empty">Нет проводок</span>`;return `<button type="button" class="cs-payment-toggle" data-payment-toggle="${id}" aria-expanded="false"><span class="cs-chevron">›</span><span>Оплаты</span><span class="cs-payment-count">${ps.length}</span></button><div class="cs-payment-details" id="${id}" style="display:none">${ps.map(p=>`<div class="cs-payment-item"><span>${esc(paymentNames[p.group]||p.group||"Проводка")}</span><b class="${Number(p.sum)<0?"negative":"positive"}">${money(p.sum)}</b></div>`).join("")}</div>`}
function setStatus(t,c=""){const e=$("cs-status");e.textContent=t;e.className="cs-status "+c}
function render(shifts){
 const t=totals(shifts),o=shifts.filter(open).length;$("cs-total").textContent=shifts.length;$("cs-open").textContent=o;$("cs-closed").textContent=shifts.length-o;$("cs-sales").textContent=t.sales?money(t.sales):"—";
 if(!shifts.length){$("cs-table-wrap").innerHTML='<div class="cs-empty">За выбранный период кассовые смены не найдены.</div>';return}
 $("cs-table-wrap").innerHTML=`<table class="cs-table"><thead><tr><th>Ресторан</th><th>Опер. день</th><th>Касса / ФР</th><th>№ смены</th><th>Фиск. №</th><th>Серийный №</th><th>Открыта</th><th>Закрыта</th><th>Кассир</th><th>Заказы</th><th>Наличные</th><th>Карта</th><th>Кредит</th><th>Внесения</th><th>Изъятия</th><th>Изъятие при закрытии</th><th>Остаток</th><th>Расхождение</th><th>Статус</th><th>Проводки</th></tr></thead><tbody>${shifts.map((s,i)=>{const st=String(v(s,"sessionStatus","")).toUpperCase(),regName=cashRegisterName(s),cashier=cashierName(s),cashierId=v(s,"responsibleUser","—");return `<tr>
<td><span class="cs-restaurant">${esc(v(s,"_restaurantName","Не определён"))}</span></td>
<td>${esc(s._operationDay||v(s,"_dateKey",v(s,"openDate","—")))}</td>
<td><b>${esc(regName||(`Касса № ${v(s,"cashRegNumber","—")}`))}</b>${regName?`<span class="cs-secondary">№ кассы ${esc(v(s,"cashRegNumber","—"))}</span>`:""}</td>
<td>${esc(v(s,"sessionNumber","—"))}</td><td>${esc(v(s,"fiscalNumber","—"))}</td><td>${esc(v(s,"cashRegSerial","—"))}</td>
<td>${esc(String(v(s,"openDate",null)||"—").replace("T"," ").replace(/\.\d+(?=Z|$)/,""))}</td>
<td>${esc(String(v(s,"closeDate",null)||"—").replace("T"," ").replace(/\.\d+(?=Z|$)/,""))}</td>
<td>${cashier?`<b>${esc(cashier)}</b><span class="cs-secondary cs-id">${esc(cashierId)}</span>`:`<span class="cs-id">${esc(cashierId)}</span>`}</td>
<td>${money(v(s,"payOrders",null))}</td><td>${money(v(s,"salesCash",null))}</td><td>${money(v(s,"salesCard",null))}</td><td>${money(v(s,"salesCredit",null))}</td><td>${money(v(s,"payIn",null))}</td><td>${money(v(s,"payOut",null))}</td><td>${money(v(s,"payIncome",null))}</td><td>${money(v(s,"cashRemain",null))}</td><td>${money(v(s,"cashDiff",null))}</td><td><span class="cs-badge ${open(s)?"cs-open":"cs-closed"}">${esc(st||"—")}</span></td><td>${paymentHtml(s,i)}</td></tr>`}).join("")}</tbody></table>`
}
async function post(c,body){const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(API,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({...c,...body})},90000);const d=await r.json().catch(()=>({success:false,message:`HTTP ${r.status}`}));if(!r.ok||!d.success)throw new Error(d.message||`HTTP ${r.status}`);return d}
async function load(){
 const binding=await getIikoBinding(),c=binding?.connection,departmentIds=Array.isArray(binding?.departmentIds)?binding.departmentIds.map(String).filter(Boolean):[];
 if(!c?.ip||!c?.port||!c?.login||!c?.password){setStatus("Нет сохранённого подключения к SH Server.","error");return}
 if(!departmentIds.length){setStatus("Не найден Department ID выбранного SH Server. Переподключитесь через Настройки.","error");return}
 const from=$("cs-from").value,to=$("cs-to").value;if(!from||!to){setStatus("Выберите период.","error");return}
 const restaurants=Array.isArray(binding?.restaurants)?binding.restaurants:[];
 const identity=binding?.identity||{};
 const restaurantSources=[
   ...restaurants,
   ...(Array.isArray(identity?.organizations)?identity.organizations:[]),
   ...(Array.isArray(identity?.departments)?identity.departments:[]),
   ...(Array.isArray(c?.organizations)?c.organizations:[]),
   ...(Array.isArray(c?.departments)?c.departments:[])
 ];
 const restaurantNames=new Map();
 for(const r of restaurantSources){
   const id=normId(r?.id);if(!id)continue;
   const name=String(r?.name||r?.code||r?.id||"").trim();
   if(name&&!restaurantNames.has(id))restaurantNames.set(id,name);
 }
 const restaurantDirectory=[...restaurantNames.entries()].map(([id,name])=>({id,name}));
 const allDepartmentIds=Array.isArray(binding?.allDepartmentIds)?binding.allDepartmentIds.map(String).filter(Boolean):departmentIds;
 const selectedDepartmentNames=departmentIds.map(id=>restaurantNames.get(normId(id))||"");
 const chainScope={
   mode:String(binding?.identity?.mode||c?.connectionType||"RMS").toUpperCase(),
   allowedDepartmentIds:allDepartmentIds,
   selectedDepartmentIds:departmentIds,
   selectedDepartmentNames,
   departments:restaurantDirectory
 };
 const decorate=list=>(list||[]).map(s=>{
   const id=normId(departmentId(s));
   const fallback=departmentIds.length===1?restaurantNames.get(normId(departmentIds[0])):"";
   return {...s,_restaurantName:String(s?._departmentName||restaurantNames.get(id)||fallback||"Не определён")};
 });
 const b=$("cs-load");b.disabled=true;setStatus("Получаем кассовые смены…");
 try{
   const all=[];let start=from,listRequests=0,lastListMeta=null;
   while(start<=to){
     const days=Math.floor((new Date(to+"T00:00:00")-new Date(start+"T00:00:00"))/86400000)+1;
     const chunk=Math.min(62,days),end=new Date(start+"T00:00:00");end.setDate(end.getDate()+chunk-1);
     const endStr=`${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}`;
     const d=await post(c,{mode:"list",from:start,to:endStr,departmentIds,selectedDepartmentIds:departmentIds,selectedDepartmentNames,departments:restaurantDirectory,chainScope});
     lastListMeta=d?.meta||lastListMeta;
     listRequests++;all.push(...decorate(d.shifts||[]));start=add(start,chunk)
   }
   const seen=new Set(),base=all.filter(s=>{const k=s._sessionId||s.id||JSON.stringify(s);if(seen.has(k))return false;seen.add(k);return true});
   render(base);
   if(!base.length){setStatus(`Смен не найдено. Запросов к Smart Horeca: ${listRequests}.`,"ok");return}
   setStatus(`Найдено ${base.length} смен. Загружаем детали…`);
   const enriched=[];let detailRequests=0;
   for(let i=0;i<base.length;i+=30){
     const slice=base.slice(i,i+30),ids=slice.map(s=>s._sessionId||s.id).filter(Boolean);
     const d=await post(c,{mode:"details",sessionIds:ids,departmentIds,selectedDepartmentIds:departmentIds,selectedDepartmentNames,departments:restaurantDirectory,chainScope,from,to});
     detailRequests++;
     const map=new Map((d.details||[]).map(x=>[String(x.sessionId),x]));
     for(const s of slice){
       const x=map.get(String(s._sessionId||s.id));
       enriched.push(x?.success?{...s,...(x.shift||{}),_payments:x.payments||[],_operationDay:x.operationDay||s._operationDay}:s)
     }
     render(enriched);
     setStatus(`Детали: ${enriched.length} из ${base.length}.`,enriched.length===base.length?"ok":"")
   }
   const unresolvedRestaurants=enriched.filter(x=>!String(x?._restaurantName||"").trim()||x._restaurantName==="Не определён").length;
   const debug=$("cs-debug");
   if(debug){
     if(unresolvedRestaurants){
       const compact={
         selectedDepartmentIds:departmentIds,
         restaurants:restaurantDirectory,
         backend:{
           chainMode:lastListMeta?.chainMode,
           rangeRequests:lastListMeta?.rangeRequests,
           restaurantNamesAttached:lastListMeta?.restaurantNamesAttached,
           detectedDepartmentIds:lastListMeta?.detectedDepartmentIds,
           targetPreview:lastListMeta?.targetPreview,
           rowDepartmentPreview:lastListMeta?.rowDepartmentPreview,
           rawScopeDiagnostics:lastListMeta?.rawScopeDiagnostics
         }
       };
       debug.hidden=false;
       debug.textContent="Диагностика ресторанов: "+JSON.stringify(compact);
     }else{
       debug.hidden=true;
       debug.textContent="";
     }
   }
   setStatus(unresolvedRestaurants
     ? `Загружено ${enriched.length} смен. Не удалось определить ресторан у ${unresolvedRestaurants} строк. Ниже показана диагностика привязки.`
     : `Загружено ${enriched.length} смен. Ресторан указан в каждой строке. Запросы: список ${listRequests}, детали ${detailRequests}.`,
     unresolvedRestaurants?"error":"ok")
 }catch(e){render([]);setStatus(e.message||"Ошибка получения смен","error")}
 finally{b.disabled=false}
}
document.addEventListener("DOMContentLoaded",()=>{$("cs-from").value=day(-6);$("cs-to").value=day(0);$("cs-load").addEventListener("click",load);$("cs-table-wrap").addEventListener("click",e=>{const btn=e.target.closest("[data-payment-toggle]");if(!btn)return;const id=btn.getAttribute("data-payment-toggle"),box=$(id);if(!box)return;const isOpen=box.style.display!=="none";box.style.display=isOpen?"none":"grid";btn.classList.toggle("is-open",!isOpen);btn.setAttribute("aria-expanded",String(!isOpen));});load()});})();
