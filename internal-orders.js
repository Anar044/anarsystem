(()=>{
"use strict";
const $=id=>document.getElementById(id),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statusNames={DRAFT:"Черновик",SUBMITTED:"На согласовании",APPROVED:"Подтверждён",PICKING:"Комплектуется",READY:"Готов к отгрузке",REJECTED:"Отклонён",CANCELLED:"Отменён"};
const state={token:"",data:null,refs:[],binding:null,storeCache:new Map(),selected:null,busy:false};
const date=v=>v?new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("ru-RU"):"—";
const number=v=>Number(v||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
function note(msg,kind=""){const x=$("io-message");x.textContent=msg||"";x.className="io-message"+(kind?" "+kind:"")}
function busy(b){state.busy=b;document.querySelectorAll(".io-btn").forEach(x=>x.disabled=b)}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw Error("Авторизация Smart Horeca недоступна");const r=await c.auth.getSession();if(!r.data?.session?.access_token)throw Error("Необходимо войти заново");return r.data.session.access_token}
async function api(path,options={}){
  const headers=new Headers(options.headers||{});headers.set("Authorization","Bearer "+state.token);if(options.body)headers.set("Content-Type","application/json");
  const r=await fetch(path,{...options,headers,cache:"no-store"});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.success===false)throw Error(j.message||"HTTP "+r.status);
  return j;
}
const get=(action="list",id="")=>api("/api/internal-orders?action="+encodeURIComponent(action)+(id?"&departmentId="+encodeURIComponent(id):""));
const post=(action,body={})=>api("/api/internal-orders",{method:"POST",body:JSON.stringify({action,...body})});
function selection(sel,items,placeholder="Выберите…",value=""){const x=$(sel);x.innerHTML='<option value="">'+esc(placeholder)+"</option>"+items.map(d=>'<option value="'+esc(d.id)+'"'+(d.id===value?" selected":"")+'>'+esc(d.name||d.id)+"</option>").join("")}
async function stores(dept){
  if(!dept)return[];
  if(state.storeCache.has(dept))return state.storeCache.get(dept);
  const j=await get("stores",dept);state.storeCache.set(dept,j.stores||[]);return j.stores||[];
}
async function fillStores(deptId,selectId,value=""){
  const select=$(selectId);select.innerHTML='<option value="">Загрузка…</option>';
  try{selection(selectId,await stores(deptId),"Выберите склад",value)}catch(e){select.innerHTML='<option value="">Ошибка загрузки складов</option>';note(e.message,"error")}
}
async function load(){
  state.data=await get();const d=state.data;
  $("io-open-create").hidden=!d.permissions?.request||!d.settings;
  $("io-config-panel").hidden=!d.permissions?.configure;
  $("io-central-label").textContent=d.settings?("Отгрузка из "+d.settings.centralDepartmentName+" · "+d.settings.centralStoreName):"Центральный склад не настроен администратором";
  if(d.permissions?.configure){
    selection("io-central-dept",d.configurableDepartments||[],"Выберите центральный RMS",d.settings?.centralDepartmentId||"");
    await fillStores($("io-central-dept").value,"io-central-store",d.settings?.centralStoreId||"");
  }
  selection("io-destination-dept",(d.departments||[]).filter(x=>x.id!==d.settings?.centralDepartmentId),"Выберите ресторан");
  $("io-kpi-submitted").textContent=d.orders.filter(x=>x.status==="SUBMITTED").length;
  $("io-kpi-active").textContent=d.orders.filter(x=>["APPROVED","PICKING","READY"].includes(x.status)).length;
  $("io-kpi-all").textContent=d.orders.length;
  render();
}
function render(){
  const d=state.data;if(!d)return;
  const query=$("io-query").value.trim().toLocaleLowerCase(),status=$("io-status-filter").value;
  const shown=d.orders.filter(o=>(!status||o.status===status)&&(!query||[o.number,o.destinationDepartmentName,o.destinationStoreName,...o.lines.map(x=>x.productName)].join(" ").toLocaleLowerCase().includes(query)));
  $("io-rows").innerHTML=shown.map(o=>'<tr><td><strong>'+esc(o.number)+'</strong><small>'+esc(date(o.createdAt))+'</small></td><td>'+esc(o.destinationDepartmentName)+'<small>'+esc(o.destinationStoreName)+'</small></td><td>'+esc(date(o.neededBy))+'</td><td>'+o.lines.length+'</td><td><span class="io-pill" data-status="'+esc(o.status)+'">'+esc(statusNames[o.status]||o.status)+'</span></td><td><button class="io-btn io-outline" data-open="'+esc(o.id)+'">Открыть</button></td></tr>').join("");
  $("io-empty").hidden=shown.length>0;
  $("io-rows").querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openDetail(b.dataset.open));
  if(state.selected){
    const selected=d.orders.find(x=>x.id===state.selected.id);
    if(selected)detail(selected);else $("io-detail").hidden=true;
  }
}
function detail(o){
  state.selected=o;
  const d=state.data,perms=d.permissions||{},centralAllowed=d.departments.some(x=>x.id===o.centralDepartmentId);
  const canFulfill=perms.fulfill&&centralAllowed;
  const isCreator=o.createdBy===state.userId;
  const canRequest=perms.request&&isCreator&&d.departments.some(x=>x.id===o.destinationDepartmentId);
  const active=o.status==="SUBMITTED"&&canFulfill;
  let body='<div class="io-detail-top"><div class="io-section-head"><h2>'+esc(o.number)+'</h2><p>'+esc(o.destinationDepartmentName)+' · '+esc(o.destinationStoreName)+' → '+esc(o.centralDepartmentName)+' · '+esc(o.centralStoreName)+'</p></div><button class="io-btn io-outline" id="io-hide-detail">Закрыть</button></div>';
  body+='<p class="io-detail-comment">Дата поставки: '+esc(date(o.neededBy))+' · Автор: '+esc(o.createdByName)+' · Статус: '+esc(statusNames[o.status]||o.status)+'</p>';
  if(o.comment)body+='<p class="io-detail-comment">Комментарий: '+esc(o.comment)+'</p>';
  if(o.reviewComment)body+='<p class="io-detail-comment">Причина: '+esc(o.reviewComment)+'</p>';
  body+='<table class="io-detail-lines"><thead><tr><th>Товар</th><th>Фасовка</th><th>Запрошено</th><th>Подтверждено</th></tr></thead><tbody>';
  for(const l of o.lines){
    const ap=o.approvedLines.find(x=>x.productId===l.productId);
    body+='<tr><td>'+esc(l.productName)+'</td><td>'+esc(l.packageName||"Основная единица")+' × '+number(l.packageSize)+'</td><td>'+number(l.packageCount)+' фас. / '+number(l.quantity)+' '+esc(l.unit)+'</td><td>'+(active?'<input type="number" min="0" max="'+esc(l.packageCount)+'" step="0.001" data-approve-id="'+esc(l.productId)+'" value="'+esc(l.packageCount)+'">':(ap?number(ap.packageCount)+' фас. / '+number(ap.quantity)+' '+esc(l.unit):"—"))+'</td></tr>';
  }
  body+='</tbody></table><div class="io-detail-actions">';
  if(canRequest&&o.status==="DRAFT")body+='<button class="io-btn io-primary" data-action="submit">Отправить на склад</button><button class="io-btn io-danger" data-action="cancel">Отменить</button>';
  if(canRequest&&o.status==="SUBMITTED")body+='<button class="io-btn io-danger" data-action="cancel">Отменить</button>';
  if(active)body+='<button class="io-btn io-primary" data-action="approve">Подтвердить количество</button><button class="io-btn io-danger" data-action="reject">Отклонить</button>';
  if(canFulfill&&o.status==="APPROVED")body+='<button class="io-btn io-primary" data-action="picking">Начать комплектацию</button>';
  if(canFulfill&&o.status==="PICKING")body+='<button class="io-btn io-primary" data-action="ready">Готов к отгрузке</button>';
  body+='</div>';
  const panel=$("io-detail");panel.innerHTML=body;panel.hidden=false;
  panel.querySelector("#io-hide-detail").onclick=()=>{panel.hidden=true;state.selected=null};
  panel.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>transition(o,b.dataset.action));
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}
function openDetail(id){const o=state.data?.orders.find(x=>x.id===id);if(o)detail(o)}
async function transition(o,action){
  const payload={id:o.id};const labels={submit:"отправить",cancel:"отменить",approve:"подтвердить",reject:"отклонить",picking:"начать комплектацию",ready:"отметить готовность"};
  if(!confirm("Действительно "+(labels[action]||action)+" заказ "+o.number+"?"))return;
  if(action==="approve")payload.approvedLines=o.lines.map(l=>({productId:l.productId,packageCount:Number($("io-detail").querySelector('[data-approve-id="'+CSS.escape(l.productId)+'"]').value)}));
  if(action==="reject"){payload.comment=prompt("Причина отклонения (обязательно):","")||"";if(!payload.comment)return}
  try{busy(true);await post(action,payload);note("Заказ "+o.number+": операция сохранена.","ok");await load()}catch(e){note(e.message,"error")}finally{busy(false)}
}
async function products(){
  if(state.refs.length)return state.refs;
  state.binding=state.binding||await window.SH_IikoContext?.getBinding?.();
  if(!state.binding?.connection?.ip)throw Error("Не настроено подключение к Smart Horeca Server");
  const b=state.binding,mode=String(b.identity?.mode||b.connection?.connectionType||"RMS").toUpperCase();
  const r=await api("/api/iiko/invoice-reference-data",{method:"POST",body:JSON.stringify({connection:b.connection,departmentIds:b.departmentIds||[],chainScope:{mode,selectedDepartmentIds:b.departmentIds||[],allowedDepartmentIds:b.allDepartmentIds||b.departmentIds||[]}})});
  state.refs=(r.products||[]).filter(x=>x.id&&x.name);
  return state.refs;
}
function productLabel(p){return p.name+" · "+String(p.id).slice(-8)}
function productByText(text){return state.refs.find(p=>productLabel(p)===text)}
function rowPackaging(w,p){
  const select=w.querySelector('[data-f="packaging"]'),pack=p?.packagings||[];
  select.innerHTML='<option value="">Основная единица · 1</option>'+pack.filter(x=>Number(x.count)>0).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.num||number(x.count))+' · '+number(x.count)+'</option>').join("");
  w.querySelector('[data-f="product"]').dataset.productId=p?.id||"";
}
function newLine(){
  const w=document.createElement("div");w.className="io-line";
  w.innerHTML='<input data-f="product" list="io-products" placeholder="Начни вводить название товара" required><select data-f="packaging" aria-label="Фасовка"><option value="">Основная единица · 1</option></select><input data-f="count" type="number" min="0.001" step="0.001" value="1" required aria-label="Количество фасовок"><span class="io-muted" data-f="total">1 шт.</span><button type="button" class="io-btn io-danger io-remove">×</button>';
  w.querySelector("[data-f='product']").onchange=()=>{
    const p=productByText(w.querySelector('[data-f="product"]').value);
    rowPackaging(w,p);updateTotal(w);
    if(!p)note("Выберите товар из подсказок справочника.","error");
  };
  w.querySelector("[data-f='packaging']").onchange=()=>updateTotal(w);
  w.querySelector("[data-f='count']").oninput=()=>updateTotal(w);
  w.querySelector(".io-remove").onclick=()=>w.remove();
  $("io-lines").appendChild(w);
}
function updateTotal(w){
  const p=state.refs.find(x=>x.id===w.querySelector("[data-f='product']").dataset.productId);
  const selected=w.querySelector("[data-f='packaging']").value;
  const pack=p?.packagings?.find(x=>String(x.id)===selected);
  w.querySelector("[data-f='total']").textContent=number(Number(pack?.count||1)*Number(w.querySelector("[data-f='count']").value||0))+" "+(p?.unit||"");
}
function formLines(){
  const out=[];
  for(const w of $("io-lines").children){
    const p=state.refs.find(x=>x.id===w.querySelector("[data-f='product']").dataset.productId);
    if(!p)throw Error("Товар не выбран из справочника iiko");
    const pid=w.querySelector("[data-f='packaging']").value,pack=p.packagings?.find(x=>String(x.id)===pid);
    out.push({productId:p.id,productName:p.name,unit:p.unit||"",containerId:pack?.id||"",packageName:pack?.name||"Основная единица",packageSize:Number(pack?.count||1),packageCount:Number(w.querySelector("[data-f='count']").value)});
  }
  if(!out.length)throw Error("Добавьте товары");
  return out;
}
async function openCreate(){
  $("io-modal").hidden=false;
  $("io-create-form").reset();
  $("io-lines").innerHTML="";
  $("io-needed-by").value=new Date(Date.now()+86400000).toISOString().slice(0,10);
  $("io-open-create").disabled=true;
  try{
    note("Загружаем справочник товаров iiko…");
    const refs=await products();
    $("io-products").innerHTML=refs.map(p=>'<option value="'+esc(productLabel(p))+'"></option>').join("");
    newLine();note("Выберите ресторан, склад и товары.","ok");
  }catch(e){note(e.message,"error")}finally{$("io-open-create").disabled=false}
}
function closeCreate(){$("io-modal").hidden=true}
async function start(){
  try{
    state.token=await token();state.binding=await window.SH_IikoContext?.getBinding?.();
    const c=await window.SHAuth?.getUser?.();state.userId=c?.id||c?.user?.id||"";
    await load();note("Список внутренних заказов загружен.","ok");
  }catch(e){note(e.message,"error")}
  document.documentElement.style.visibility="visible";
}
async function handleCreate(e){
  e.preventDefault();
  try{busy(true);const j=await post("create",{destinationDepartmentId:$("io-destination-dept").value,destinationStoreId:$("io-destination-store").value,neededBy:$("io-needed-by").value,comment:$("io-comment").value,lines:formLines()});closeCreate();note("Заказ "+j.number+" сохранён как черновик.","ok");await load();openDetail(j.id)}catch(e){note(e.message,"error")}finally{busy(false)}
}
async function handleConfig(e){
  e.preventDefault();
  try{busy(true);await post("save-settings",{centralDepartmentId:$("io-central-dept").value,centralStoreId:$("io-central-store").value});state.storeCache.clear();note("Центральный склад сохранён.","ok");await load()}catch(e){note(e.message,"error")}finally{busy(false)}
}
$("io-refresh").onclick=async()=>{try{busy(true);await load();note("Данные обновлены.","ok")}catch(e){note(e.message,"error")}finally{busy(false)}};
$("io-query").oninput=render;$("io-status-filter").onchange=render;
$("io-open-create").onclick=openCreate;$("io-close").onclick=closeCreate;$("io-cancel").onclick=closeCreate;$("io-modal-shade").onclick=closeCreate;$("io-add-product").onclick=newLine;
$("io-central-dept").onchange=()=>fillStores($("io-central-dept").value,"io-central-store");
$("io-destination-dept").onchange=()=>fillStores($("io-destination-dept").value,"io-destination-store");
$("io-config-form").onsubmit=handleConfig;$("io-create-form").onsubmit=handleCreate;
start();
})();