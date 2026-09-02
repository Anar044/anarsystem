(() => {
  const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const low = v => String(v ?? "").toLowerCase();

  const TITLES = {
    newOrder:"🟢 Заказ открыт", deletionOfNotPrintedItem:"🗑️ Удалено нераспечатанное блюдо", deletionOfPrintedItem:"🗑️ Удалено распечатанное блюдо",
    addingDiscount:"🏷️ Применена скидка", removingDiscount:"🏷️ Скидка удалена", orderGuestBill:"🧾 Сформирован пречек",
    cancellationOfGuestBill:"↩️ Пречек отменён", voidReceipt:"↩️ Чек аннулирован", deletingAnOrder:"🗑️ Заказ удалён",
    closingOrder:"🔒 Заказ закрыт", orderTableHasBeenChanged:"🪑 Изменён стол", ordersWaiterHasChanged:"👤 Изменён официант",
    addingSurcharge:"➕ Добавлена наценка", removingSurcharge:"➖ Наценка удалена", printer:"🖨️ Печать",
    cashRegisterStart:"💵 Открыта кассовая смена", cashRegisterShutDown:"💵 Закрыта кассовая смена"
  };

  const style=document.createElement("style");
  style.textContent=`
    .history-v2-total{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:12px;padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface2)}
    .history-v2-total span{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.history-v2-total strong{font-size:18px;color:var(--pc-green)}
    .history-v2-note{margin-top:8px;color:var(--muted);font-size:10px}.history-v2-error{padding:16px;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
  `; document.head.appendChild(style);

  function first(v){
    if(v===null||v===undefined||v==="")return null;
    if(["string","number","boolean"].includes(typeof v))return v;
    if(Array.isArray(v)){for(const x of v){const z=first(x);if(z!==null)return z}return null}
    for(const k of ["name","Name","title","Title","value","Value","itemName","ItemName","productName","ProductName","dishName","DishName"]){if(v[k]!==undefined&&v[k]!==null&&v[k]!=="")return first(v[k])}
    return null;
  }

  function deepGet(obj,names,depth=0){
    if(!obj||typeof obj!=="object"||depth>12)return null;
    const wanted=names.map(x=>String(x).toLowerCase());
    for(const [k,v] of Object.entries(obj)){
      if(wanted.includes(k.toLowerCase())&&v!==null&&v!==undefined&&v!=="")return v;
    }
    for(const v of Object.values(obj)){
      const found=deepGet(v,names,depth+1); if(found!==null)return found;
    }
    return null;
  }

  function pluginId(){const s=document.getElementById("plugin-select"),o=s?.selectedOptions?.[0];return o?.dataset?.pluginId||o?.value||""}
  function fmt(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}
  function field(o,n){return first(deepGet(o,n))}
  function eventTime(e){return deepGet(e,["eventAt","receivedAt","createdAt","timestamp","time"])||deepGet(e?.data,["updateTime","openTime","closeTime","billTime"])}
  function payment(data){
    const direct=field(data,["paymentType","paymentTypeName","paymentMethod","paymentName","payType","payTypeName"]); if(direct)return direct;
    const p=deepGet(data,["payments","payment"]); if(!p)return null;
    if(Array.isArray(p)){const out=[];for(const x of p){if(!x)continue;let n=first(x.name??x.Name??x.title??x.Title);const t=low(x.type??x.Type??x.paymentType??x.PaymentType);if(!n)n=/cash|налич/.test(t)?"Наличные":/card|карта|банков|terminal|терминал/.test(t)?"Карта":first(x.value??x.Value);if(n&&!out.includes(String(n)))out.push(String(n))}return out.length?out.join(", "):null}
    return first(p)
  }

  function detailsFromHistory(history){
    const out={};
    const map={
      tables:["tables","orderTables","table","tableName"], floor:["floor","floorName","restaurantSection","section","hall"],
      waiter:["waiter","waiterName","waiterFullName","employee","employeeName","employeeFullName"],
      cashier:["cashier","cashierName","cashierFullName"], revenue:["revenue","resultSum","orderSum","sum","total"],
      openTime:["openTime","orderOpenDate","openedAt","openingTime"], billTime:["billTime","orderBillTime","precheckTime","precheckAt"],
      closeTime:["closeTime","orderCloseTime","orderCloseDate","closedAt","closingTime"]
    };
    for(let i=(history||[]).length-1;i>=0;i--){const d=history[i]?.data;if(!d)continue;for(const [k,n] of Object.entries(map))if(out[k]==null){const v=deepGet(d,n);if(v!==null)out[k]=v}if(out.payment==null){const p=payment(d);if(p)out.payment=p}}
    return out;
  }

  function requestHistory(number){
    const q=pluginId(), suffix=q?`&pluginId=${encodeURIComponent(q)}`:"";
    return fetch(`/api/plugin/order-history?orderNum=${encodeURIComponent(number)}${suffix}`,{cache:"no-store"}).then(async r=>{const j=await r.json();if(!r.ok||!j.success)throw new Error(j.error||`HTTP ${r.status}`);return Array.isArray(j.history)?j.history:[]})
  }
  function requestOrder(number){
    const body={action:"get_order",params:{orderNum:Number(number)||number}};const p=pluginId();if(p)body.pluginId=p;
    return fetch("/api/plugin/request",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},cache:"no-store",body:JSON.stringify(body)}).then(async r=>{const j=await r.json();if(!r.ok||!j.success)throw new Error(j.error||`HTTP ${r.status}`);return j.data||null})
  }

  function applyRow(row,history){
    const d=detailsFromHistory(history),c=row.querySelectorAll("td");
    const vals=[d.tables,d.floor,d.waiter,d.cashier,d.revenue,d.openTime,d.billTime,d.closeTime,d.payment];
    const idx=[2,3,4,5,6,7,8,9,10];
    idx.forEach((n,i)=>{if(vals[i]!==null&&vals[i]!==undefined&&vals[i]!=="")c[n].textContent=i>=5&&i<=7?fmt(vals[i]):String(first(vals[i])??vals[i])});
  }

  async function enrichTable(){
    const rows=[...document.querySelectorAll("#orders-table-body tr.order-click")];
    for(const row of rows){if(row.dataset.historyV2==="loading"||row.dataset.historyV2==="done")continue;const n=row.dataset.orderNumber;if(!n)continue;row.dataset.historyV2="loading";try{applyRow(row,await requestHistory(n));row.dataset.historyV2="done"}catch(_){row.dataset.historyV2="error"}}
  }

  function orderField(o,n){return field(o,n)}
  function set(modal,id,v){const e=modal.querySelector(`#${id}`);if(e)e.textContent=v??"—"}

  function renderComposition(slot,order){
    const items=Array.isArray(order?.items)?order.items.filter(Boolean):[];
    if(!items.length){slot.innerHTML='<div class="order-empty">В текущем заказе нет оставшихся блюд.</div>';return}
    const rows=items.map(i=>{const n=orderField(i,["name","itemName","productName","dishName"] )||"—",q=orderField(i,["amount","quantity","count"])??1,p=orderField(i,["price","unitPrice"]),s=orderField(i,["resultSum","sum","itemSum","total"]);return`<tr><td><strong>${esc(n)}</strong></td><td>${esc(q)}</td><td>${esc(p??"—")}</td><td>${esc(s??"—")}</td></tr>`}).join("");
    const total=orderField(order,["revenue","Revenue"]);slot.innerHTML=`<table class="order-items"><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>${total!==null?`<div class="history-v2-total"><span>Итоговая сумма чека</span><strong>${esc(total)}</strong></div>`:""}<div class="history-v2-note">Состав взят из актуальных данных заказа iiko. Удалённые блюда и служебные операции сюда не попадают.</div>`
  }

  function eventTitle(t){return TITLES[t]||`🔹 ${t||"Событие заказа"}`}
  function eventDesc(d){const a=first(deepGet(d,["user","userName","employee","employeeName","waiter","waiterName","cashier","cashierName"])),i=first(deepGet(d,["item","itemName","product","productName","dishName","deletedItem","addedItem","orderItem"])),q=first(deepGet(d,["amount","quantity","count","itemsAmount","itemAmount"])),pay=payment(d),sum=first(deepGet(d,["revenue","sum","amountSum","resultSum","orderSum"]));const x=[];if(a)x.push(`Сотрудник: ${a}`);if(i)x.push(`Блюдо: ${i}`);if(q!==null)x.push(`Количество: ${q}`);if(pay)x.push(`Оплата: ${pay}`);if(sum!==null)x.push(`Сумма: ${sum}`);return x.join(" · ")}

  async function openV2(number,source){
    const m=document.createElement("div");m.className="order-modal";m.innerHTML=`<div class="order-modal-card"><div class="order-modal-head"><div><div class="panel-muted">ДЕТАЛИ ЗАКАЗА</div><h2>Заказ #${esc(number)}</h2><div class="timeline-meta">Актуальный состав отдельно от полного журнала действий</div></div><button class="order-modal-close" type="button">Закрыть</button></div><div class="order-detail-grid"><div class="order-detail-box"><span>Стол</span><strong id="v2-table">—</strong></div><div class="order-detail-box"><span>Зал</span><strong id="v2-floor">—</strong></div><div class="order-detail-box"><span>Официант</span><strong id="v2-waiter">—</strong></div><div class="order-detail-box"><span>Кассир</span><strong id="v2-cashier">—</strong></div><div class="order-detail-box"><span>Сумма</span><strong id="v2-revenue">—</strong></div><div class="order-detail-box"><span>Открыт</span><strong id="v2-open">—</strong></div><div class="order-detail-box"><span>Пречек</span><strong id="v2-bill">—</strong></div><div class="order-detail-box"><span>Закрыт</span><strong id="v2-close">—</strong></div><div class="order-detail-box"><span>Оплата</span><strong id="v2-payment">—</strong></div></div><div class="order-modal-section"><h3>Состав заказа</h3><div id="history-v2-items" class="order-loading">Загружаем актуальный состав…</div></div><div class="order-modal-section"><h3>История событий</h3><div id="history-v2-events" class="order-loading">Загружаем историю…</div></div></div>`;document.body.appendChild(m);m.querySelector(".order-modal-close").onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};
    set(m,"v2-table",orderField(source,["tables","Tables","orderTables"]));set(m,"v2-floor",orderField(source,["floor","Floor"]));set(m,"v2-waiter",orderField(source,["waiter","Waiter"]));set(m,"v2-cashier",orderField(source,["cashier","Cashier"]));set(m,"v2-revenue",orderField(source,["revenue","Revenue","orderExpectedRevenue"]));set(m,"v2-open",fmt(orderField(source,["openTime","OpenTime","orderOpenDate"])));set(m,"v2-bill",fmt(orderField(source,["billTime","BillTime","orderBillTime"])));set(m,"v2-close",fmt(orderField(source,["closeTime","CloseTime","orderCloseTime"])));set(m,"v2-payment",payment(source));
    const hp=requestHistory(number).then(h=>{h.sort((a,b)=>new Date(eventTime(a)||0)-new Date(eventTime(b)||0));const d=detailsFromHistory(h);set(m,"v2-table",d.tables??orderField(source,["tables","Tables","orderTables"]));set(m,"v2-floor",d.floor??orderField(source,["floor","Floor"]));set(m,"v2-waiter",d.waiter??orderField(source,["waiter","Waiter"]));set(m,"v2-cashier",d.cashier??orderField(source,["cashier","Cashier"]));set(m,"v2-revenue",d.revenue??orderField(source,["revenue","Revenue"]));set(m,"v2-open",fmt(d.openTime??orderField(source,["openTime","OpenTime"])));set(m,"v2-bill",fmt(d.billTime??orderField(source,["billTime","BillTime"])));set(m,"v2-close",fmt(d.closeTime??orderField(source,["closeTime","CloseTime","orderCloseTime"])));set(m,"v2-payment",d.payment??payment(source));const s=m.querySelector("#history-v2-events");if(!h.length){s.innerHTML='<div class="order-empty">Для этого заказа пока нет сохранённых событий.</div>';return}s.className="order-timeline";s.innerHTML=h.map(e=>{const d=e.data||{},desc=eventDesc(d);return`<div class="timeline-item"><div class="timeline-event"><div class="timeline-time">${esc(fmt(eventTime(e)))}</div><div class="timeline-title">${esc(eventTitle(e.pluginEventType))}</div>${desc?`<div class="timeline-meta">${esc(desc)}</div>`:""}<details class="timeline-details"><summary>Показать данные события</summary><div class="timeline-data">${esc(JSON.stringify(d,null,2))}</div></details></div></div>`}).join("")}).catch(e=>{m.querySelector("#history-v2-events").innerHTML=`<div class="history-v2-error">Не удалось загрузить историю: ${esc(e.message)}</div>`});
    const op=requestOrder(number).then(o=>{if(!o)throw new Error("Плагин не вернул данные заказа");set(m,"v2-table",orderField(o,["tables","Tables","orderTables"]));set(m,"v2-floor",orderField(o,["floor","Floor"]));set(m,"v2-waiter",orderField(o,["waiter","Waiter"]));set(m,"v2-cashier",orderField(o,["cashier","Cashier"]));set(m,"v2-revenue",orderField(o,["revenue","Revenue"]));set(m,"v2-open",fmt(orderField(o,["openTime","OpenTime"])));set(m,"v2-bill",fmt(orderField(o,["billTime","BillTime"])));set(m,"v2-close",fmt(orderField(o,["closeTime","CloseTime","orderCloseTime"])));set(m,"v2-payment",payment(o));renderComposition(m.querySelector("#history-v2-items"),o)}).catch(e=>{m.querySelector("#history-v2-items").innerHTML=`<div class="history-v2-error">Не удалось получить актуальный состав заказа: ${esc(e.message)}</div>`});
    await Promise.allSettled([hp,op]);
  }

  document.addEventListener("click",e=>{const row=e.target.closest?.("tr.order-click");if(!row)return;const n=row.dataset.orderNumber;if(!n)return;e.preventDefault();e.stopPropagation();const c=row.querySelectorAll("td");openV2(n,{orderNum:n,tables:c[2]?.textContent?.trim(),floor:c[3]?.textContent?.trim(),waiter:c[4]?.textContent?.trim(),cashier:c[5]?.textContent?.trim(),revenue:c[6]?.textContent?.trim(),openTime:c[7]?.textContent?.trim(),billTime:c[8]?.textContent?.trim(),closeTime:c[9]?.textContent?.trim(),payment:c[10]?.textContent?.trim()})},true);
  const observer=new MutationObserver(()=>enrichTable());observer.observe(document.body,{childList:true,subtree:true});setTimeout(enrichTable,250);
})();