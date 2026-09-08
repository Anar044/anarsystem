(() => {
  const $ = id => document.getElementById(id);
  const state = { plugins: [], pluginId: '', orders: [], selectedFilter: 'all', search: '', timer: null, busy: false };

  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const primitive = value => value == null ? null : (typeof value === 'object' ? null : value);
  const first = value => {
    if (value == null || value === '') return null;
    if (primitive(value) !== null) return value;
    if (Array.isArray(value)) { for (const x of value) { const v = first(x); if (v !== null && v !== '') return v; } return null; }
    for (const k of ['name','title','value','number','code','id']) { const v = first(value[k]); if (v !== null && v !== '') return v; }
    return null;
  };
  const find = (obj, names, depth = 0) => {
    if (obj == null || depth > 10 || typeof obj !== 'object') return null;
    const wanted = names.map(x => String(x).toLowerCase());
    if (Array.isArray(obj)) { for (const x of obj) { const v = find(x, names, depth + 1); if (v !== null && v !== '') return v; } return null; }
    for (const [k,v] of Object.entries(obj)) if (wanted.includes(k.toLowerCase()) && v !== null && v !== '') return v;
    for (const v of Object.values(obj)) { const r = find(v, names, depth + 1); if (r !== null && r !== '') return r; }
    return null;
  };
  const number = value => {
    const v = first(value);
    if (v == null || v === '') return NaN;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n) ? n : NaN;
  };
  const money = value => { const n = number(value); return Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; };
  const date = value => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
  const isoTime = value => { if (!value) return 0; const d = new Date(value); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };

  function unwrap(data) {
    if (typeof data === 'string') { try { return JSON.parse(data); } catch { return data; } }
    return data;
  }
  function arrayRows(value, depth=0) {
    if (value == null || depth > 10) return [];
    if (Array.isArray(value)) return value.filter(x => x && typeof x === 'object');
    if (typeof value !== 'object') return [];
    for (const key of ['orders','items','rows','records','data','result','report']) {
      if (value[key] !== undefined) { const r = arrayRows(value[key], depth+1); if (r.length) return r; }
    }
    for (const v of Object.values(value)) { const r = arrayRows(v, depth+1); if (r.length) return r; }
    return [];
  }
  function scalarField(row, names) { return first(find(row,names)); }
  function orderNumber(row,index) { return scalarField(row,['orderNum','orderNumber','orderNo','number','num']) ?? index+1; }
  function orderAmount(row) { return number(find(row,['orderExpectedRevenue','orderSum','revenue','resultSum','total','sum','amount','moneySum','paidSum'])); }
  function rawStatus(row) { return String(scalarField(row,['orderStatus','status','state','orderState','statusName','deliveryStatus']) ?? '').trim(); }
  function orderState(row) {
    const s = rawStatus(row).toLowerCase();
    if (/(cancel|cancell|deleted|removed|удал|отмен)/.test(s)) return 'other';
    if (s === 'true' || /(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(s)) return 'closed';
    if (s === 'false' || /(open|opened|active|new|bill|открыт|открыто|актив|новый|пречек)/.test(s)) return 'open';
    if (find(row,['closeTime','orderCloseTime','closedAt','closingTime','closeDate'])) return 'closed';
    return 'other';
  }
  function paymentParts(row) {
    const payments = find(row,['Payments','payments','payment','paymentItems']);
    const result = [];
    const add = (name, amount) => { if (!name) return; const existing = result.find(x => x.name.toLowerCase() === String(name).toLowerCase()); if (existing) { if (Number.isFinite(amount)) existing.amount += amount; existing.count++; } else result.push({name:String(name),amount:Number.isFinite(amount)?amount:0,count:1}); };
    if (Array.isArray(payments)) {
      payments.forEach(p => {
        if (!p || typeof p !== 'object') return;
        const name = first(p.name ?? p.Name ?? p.paymentTypeName ?? p.paymentType ?? p.type ?? p.Type) || 'Оплата';
        const amount = number(p.sum ?? p.amount ?? p.value ?? p.moneySum ?? p.Sum ?? p.Amount);
        add(name, amount);
      });
    }
    if (!result.length) {
      const direct = scalarField(row,['paymentTypeName','paymentType','paymentMethod','paymentName','payTypeName','payType']);
      if (direct) add(direct, orderAmount(row));
    }
    return result;
  }
  function paymentText(row) { return paymentParts(row).map(x=>x.name).join(', ') || '—'; }
  function tableText(row) { return scalarField(row,['tableName','table','tables','orderTables']) ?? '—'; }
  function floorText(row) { return scalarField(row,['floorName','floor','restaurantSection','sectionName']) ?? '—'; }
  function waiterText(row) { return scalarField(row,['waiterName','waiter','waiterFullName','employeeName','employee','orderWaiter']) ?? '—'; }
  function cashierText(row) { return scalarField(row,['cashierName','cashier','cashierFullName','orderCashier']) ?? '—'; }
  function openTime(row) { return scalarField(row,['openTime','orderOpenDate','openedAt','openingTime','openDate','createdAt']); }
  function closeTime(row) { return scalarField(row,['closeTime','orderCloseTime','closedAt','closingTime','closedDate']); }
  function currency(row) { return scalarField(row,['currencyCode','currency','currencyName']) || ''; }

  async function getPlugins() {
    const response = await fetch('/api/plugin/data',{cache:'no-store'});
    if (!response.ok) throw new Error(`Ошибка подключения: HTTP ${response.status}`);
    const data = unwrap(await response.json());
    let list = Array.isArray(data) ? data : (data?.plugins || data?.data || data?.items || []);
    if (!Array.isArray(list)) list = [];
    state.plugins = list.map(x => x?.data ? {...x, ...x.data} : x).filter(Boolean);
    const selected = state.plugins.find(x => x.pluginId) || state.plugins[0];
    state.pluginId = selected?.pluginId || '';
    $('cash-name').textContent = selected?.pluginName || selected?.groupName || 'Касса';
    $('cash-subtitle').textContent = selected ? `Касса ${selected.pluginName || selected.pluginId || ''} · данные непосредственно от подключённого плагина.` : 'Подключённая касса не найдена.';
    $('connection').className = `cash-connection ${selected ? 'online' : 'offline'}`;
    $('connection').textContent = selected ? '● Касса подключена' : '● Нет подключения';
    return selected;
  }

  async function request(action, extra={}) {
    const body = { action, ...(state.pluginId ? {pluginId:state.pluginId} : {}), ...extra };
    const response = await fetch('/api/plugin/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { throw new Error(`Плагин вернул не JSON (HTTP ${response.status})`); }
    if (!response.ok || data?.success === false && data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
    return unwrap(data);
  }

  async function loadOrders() {
    if (state.busy) return;
    state.busy = true;
    try {
      await getPlugins();
      if (!state.pluginId) { state.orders=[]; render(); return; }
      const payload = await request('get_orders');
      const rows = arrayRows(payload);
      const seen = new Set();
      state.orders = rows.map((row,index)=>({row,index,num:String(orderNumber(row,index))})).filter(x=>{if(seen.has(x.num))return false;seen.add(x.num);return true;});
      $('cash-updated').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
      $('technical-output').textContent = JSON.stringify(payload,null,2);
      render();
    } catch (error) {
      $('connection').className='cash-connection offline'; $('connection').textContent='● Ошибка получения данных';
      $('orders').innerHTML=`<tr><td colspan="10" class="error-cell">${escape(error.message || error)}</td></tr>`;
      $('orders-footer').textContent='Не удалось получить данные от кассы.';
    } finally { state.busy=false; }
  }

  function filteredOrders() {
    const q = state.search.trim().toLowerCase();
    return state.orders.filter(x => {
      const s = orderState(x.row);
      if (state.selectedFilter === 'open' && s !== 'open') return false;
      if (state.selectedFilter === 'closed' && s !== 'closed') return false;
      if (state.selectedFilter === 'other' && s !== 'other') return false;
      if (!q) return true;
      const hay = [x.num,rawStatus(x.row),tableText(x.row),floorText(x.row),waiterText(x.row),cashierText(x.row),paymentText(x.row)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderKpis() {
    let closedSum=0,openSum=0,closedCount=0,openCount=0,otherCount=0;
    state.orders.forEach(x=>{const s=orderState(x.row),a=orderAmount(x.row);if(s==='closed'){closedCount++;if(Number.isFinite(a))closedSum+=a}else if(s==='open'){openCount++;if(Number.isFinite(a))openSum+=a}else otherCount++;});
    $('closed-sum').textContent=money(closedSum); $('open-sum').textContent=money(openSum); $('expected-sum').textContent=money(closedSum+openSum); $('orders-count').textContent=state.orders.length.toLocaleString('ru-RU');
    $('closed-count').textContent=`${closedCount} ${plural(closedCount,'заказ','заказа','заказов')}`; $('open-count').textContent=`${openCount} ${plural(openCount,'заказ','заказа','заказов')}`; $('status-counts').textContent=`${closedCount} закрытых · ${openCount} открытых · ${otherCount} других`;
    return {closedSum,openSum,closedCount,openCount,otherCount};
  }
  function plural(n,a,b,c){const x=Math.abs(n)%100;const y=x%10;return x>10&&x<20?c:y===1?a:y>=2&&y<=4?b:c;}

  function renderPayments() {
    const map = new Map(); let total=0;
    state.orders.filter(x=>orderState(x.row)==='closed').forEach(x=>paymentParts(x.row).forEach(p=>{const key=p.name.trim()||'Не указан';if(!map.has(key))map.set(key,{name:key,amount:0,count:0});const v=map.get(key);v.amount+=p.amount;v.count++;total+=p.amount;}));
    if (!map.size) { $('payments').innerHTML='<div class="empty-state">Для закрытых заказов способ оплаты не передан кассой.</div>'; $('payments-total').textContent='0,00'; return; }
    const list=[...map.values()].sort((a,b)=>b.amount-a.amount); const max=Math.max(...list.map(x=>x.amount),1);
    $('payments-total').textContent=money(total);
    $('payments').innerHTML=list.slice(0,8).map(x=>`<div class="payment-row"><div class="payment-name">${escape(x.name)}<span class="payment-meta">${x.count} ${plural(x.count,'заказ','заказа','заказов')} · ${total?((x.amount/total)*100).toFixed(1):'0.0'}%</span></div><div class="payment-track"><div class="payment-fill" style="width:${Math.max(2,(x.amount/max)*100)}%"></div></div><div class="payment-value">${escape(money(x.amount))}</div></div>`).join('');
  }

  function renderStatuses(stats) {
    const total=state.orders.length||1;
    const items=[['Закрытые','closed',stats.closedCount],['Открытые','open',stats.openCount],['Другие','other',stats.otherCount]];
    $('status-chart').innerHTML=items.map(([name,cls,count])=>`<div class="status-row"><div class="status-label">${name}</div><div class="status-track"><div class="status-fill ${cls}" style="width:${Math.max(count?2:0,(count/total)*100)}%"></div></div><div class="status-value">${count} · ${((count/total)*100).toFixed(0)}%</div></div>`).join('');
  }

  function renderOrders() {
    const rows=filteredOrders();
    $('orders').innerHTML=rows.length ? rows.map(x=>{
      const r=x.row,s=orderState(r), status=s==='closed'?'Закрыт':s==='open'?'Открыт':(rawStatus(r)||'Другой');
      return `<tr data-num="${escape(x.num)}"><td><span class="order-num">#${escape(x.num)}</span></td><td><span class="order-status ${s}">${escape(status)}</span></td><td>${escape(tableText(r))}</td><td>${escape(floorText(r))}</td><td>${escape(waiterText(r))}</td><td class="order-amount">${escape(money(orderAmount(r)))}</td><td>${escape(date(openTime(r)))}</td><td>${escape(date(closeTime(r)))}</td><td class="order-payment">${escape(paymentText(r))}</td><td><span class="open-order">Открыть ↗</span></td></tr>`;
    }).join('') : '<tr><td colspan="10" class="empty-cell">Заказы по выбранному фильтру не найдены.</td></tr>';
    $('orders-footer').textContent=`Показано ${rows.length} из ${state.orders.length} заказов · нажмите строку для подробностей`;
    $('orders').querySelectorAll('tr[data-num]').forEach(tr=>tr.addEventListener('click',()=>openOrder(tr.dataset.num)));
  }
  function render(){const stats=renderKpis();renderPayments();renderStatuses(stats);renderOrders();}

  function scalarEntries(obj) {
    const out=[]; const walk=(v,p='',d=0)=>{if(v==null||d>3)return;if(Array.isArray(v))return;if(typeof v!=='object'){out.push([p,v]);return}for(const [k,x] of Object.entries(v)){if(['items','orderItems','products','payments','modifiers','history','events','raw'].includes(k.toLowerCase()))continue;if(x==null||typeof x!=='object')out.push([p?`${p}.${k}`:k,x]);else if(d<2)walk(x,p?`${p}.${k}`:k,d+1)}};walk(obj);return out;}
  function findItems(obj,depth=0){if(obj==null||depth>8)return[];if(Array.isArray(obj)&&obj.some(x=>x&&typeof x==='object'))return obj.filter(Boolean);if(typeof obj!=='object')return[];for(const k of ['items','orderItems','products','menuItems','dishes'])if(obj[k]!==undefined){const a=findItems(obj[k],depth+1);if(a.length)return a}for(const v of Object.values(obj)){const a=findItems(v,depth+1);if(a.length)return a}return[];}

  async function openOrder(num) {
    const modal=$('order-modal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
    $('order-modal-title').textContent=`Заказ #${num}`; $('order-modal-subtitle').textContent='Загрузка полной информации…'; $('order-details').innerHTML='<div class="modal-loading">Получаем данные заказа…</div>'; $('order-items').innerHTML=''; $('order-history').innerHTML='<div class="modal-loading">Получаем историю событий…</div>';
    const base=state.orders.find(x=>x.num===String(num))?.row || {};
    renderOrderDetails(base);
    try {
      const detail=await request('get_order',{orderNum:num});
      const order=detail?.order || detail?.data?.order || detail?.data || detail?.result || detail;
      renderOrderDetails(order||base); renderItems(order||base);
    } catch(e) { renderItems(base); $('order-modal-subtitle').textContent='Полная детализация недоступна — показаны данные списка.'; }
    try {
      const url=`/api/plugin/order-history?orderNum=${encodeURIComponent(num)}${state.pluginId?`&pluginId=${encodeURIComponent(state.pluginId)}`:''}`;
      const response=await fetch(url,{cache:'no-store'}); const history=unwrap(await response.json()); renderHistory(history);
    } catch(e) { $('order-history').innerHTML='<div class="modal-empty">История событий недоступна.</div>'; }
  }
  function renderOrderDetails(row){const s=orderState(row), status=s==='closed'?'Закрыт':s==='open'?'Открыт':(rawStatus(row)||'Другой');$('order-modal-subtitle').textContent=`${status} · ${money(orderAmount(row))}`;const fields=[['Статус',status],['Сумма',money(orderAmount(row))],['Стол',tableText(row)],['Зал',floorText(row)],['Официант',waiterText(row)],['Кассир',cashierText(row)],['Открыт',date(openTime(row))],['Закрыт',date(closeTime(row))],['Оплата',paymentText(row)],['Гости',scalarField(row,['guestCount','guests','numberOfGuests'])??'—'],['Пречек',date(scalarField(row,['billTime','precheckTime','precheckAt']))],['Терминал',scalarField(row,['terminalGroupName','terminalGroup','terminalName'])??'—']];$('order-details').innerHTML=fields.map(([k,v])=>`<div class="detail"><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join('');}
  function renderItems(row){const items=findItems(row);if(!items.length){$('order-items').innerHTML='<div class="modal-empty">Состав заказа не передан в ответе.</div>';return}const rows=items.map((x,i)=>{const name=first(x?.productName??x?.itemName??x?.dishName??x?.name??x?.title)||`Позиция ${i+1}`;const qty=first(x?.quantity??x?.amount??x?.count)||'—';const price=number(x?.price??x?.unitPrice);const sum=number(x?.sum??x?.total??x?.amount??x?.moneySum);return `<tr><td>${escape(name)}</td><td>${escape(qty)}</td><td>${escape(money(price))}</td><td>${escape(money(sum))}</td></tr>`}).join('');$('order-items').innerHTML=`<div class="table-wrap"><table class="items-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table></div>`;}
  function historyRows(payload){if(Array.isArray(payload))return payload;for(const k of ['events','history','items','data','result'])if(payload?.[k]){const r=historyRows(payload[k]);if(r.length)return r}return[];}
  function renderHistory(payload){const rows=historyRows(unwrap(payload));if(!rows.length){$('order-history').innerHTML='<div class="modal-empty">Для этого заказа событий пока нет.</div>';return}rows.sort((a,b)=>isoTime(first(find(a,['timestamp','eventTimestamp','createdAt','time','date']))) - isoTime(first(find(b,['timestamp','eventTimestamp','createdAt','time','date']))));$('order-history').innerHTML=`<div class="timeline">${rows.map((e,i)=>{const t=first(find(e,['timestamp','eventTimestamp','createdAt','time','date']));const title=first(find(e,['eventName','eventType','type','name','action','operation']))||`Событие ${i+1}`;const actor=first(find(e,['userName','employeeName','waiterName','cashierName','user','employee']));const meta=actor?`Исполнитель: ${actor}`:'';const scalars=scalarEntries(e).slice(0,14);return `<article class="timeline-item"><div class="timeline-time">${escape(date(t))}</div><div class="timeline-title">${escape(title)}</div>${meta?`<div class="timeline-time">${escape(meta)}</div>`:''}${scalars.length?`<div class="timeline-data">${escape(scalars.map(([k,v])=>`${k}: ${v}`).join('\n'))}</div>`:''}</article>`}).join('')}</div>`;}

  function closeModal(){ $('order-modal').classList.add('hidden');$('order-modal').setAttribute('aria-hidden','true'); }
  $('refresh').addEventListener('click',()=>loadOrders()); $('search').addEventListener('input',e=>{state.search=e.target.value;renderOrders();});
  $('filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.selectedFilter=b.dataset.filter;$('filters').querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderOrders();});
  document.querySelectorAll('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  loadOrders(); state.timer=setInterval(loadOrders,10000);
})();
