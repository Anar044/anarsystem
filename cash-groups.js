(() => {
  'use strict';

  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const unwrap=v=>{if(typeof v==='string'){try{return JSON.parse(v)}catch{return v}}return v};
  const num=v=>{if(v==null||v==='')return NaN;if(typeof v==='number')return Number.isFinite(v)?v:NaN;const n=Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));return Number.isFinite(n)?n:NaN};
  const money=v=>{const n=num(v);return Number.isFinite(n)?n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼':'—'};
  const dt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})};
  const rawStatus=r=>String(r?.orderStatus??r?.deliveryOrderStatus??r?.status??'').trim();
  const status=r=>{const s=rawStatus(r).toLowerCase();if(/deleted|cancelled|canceled|отмен|удал/.test(s))return'other';if(['closed','paid','закрыт','закрыто'].includes(s)||r?.orderCloseTime||r?.closeTime)return'closed';if(['new','bill','open','opened','открыт','открыто','новый'].includes(s))return'open';return'other'};
  const statusText=r=>status(r)==='closed'?'Закрыт':status(r)==='open'?'Открыт':rawStatus(r)||'Другой';
  const amount=r=>num(r?.orderExpectedRevenue??r?.revenue??r?.resultSum??r?.orderSum);
  const orderNum=r=>String(r?.orderNum??r?.number??'');
  const plural=(n,a,b,c)=>{const x=Math.abs(n)%100,y=x%10;return x>10&&x<20?c:y===1?a:y>=2&&y<=4?b:c};
  const state={cards:[],filters:new Map(),search:new Map(),binding:null};

  async function binding(){return await window.SH_IikoContext?.getBinding?.()||{departmentIds:[],restaurants:[]}}
  async function api(path,init){const r=await fetch(path,{cache:'no-store',...(init||{})});const text=await r.text();let d;try{d=JSON.parse(text)}catch{throw Error(`HTTP ${r.status}: ответ не JSON`)}if(!r.ok||d?.success===false&&d?.error)throw Error(d?.error||`HTTP ${r.status}`);return unwrap(d)}

  function rows(payload){
    const root=unwrap(payload)?.data??unwrap(payload)??{},out=[];
    for(const g of(Array.isArray(root.terminalsGroups)?root.terminalsGroups:[]))for(const s of(Array.isArray(g?.restaurantSections)?g.restaurantSections:[])){
      for(const r of(Array.isArray(s.orders)?s.orders:[]))out.push({...r,__sectionName:s.restaurantSectionName||''});
      for(const r of(Array.isArray(s.deliveries)?s.deliveries:[]))out.push({...r,__sectionName:s.restaurantSectionName||''});
      for(const x of(Array.isArray(s.reserves)?s.reserves:[]))if(x?.reserveOrder)out.push({...x.reserveOrder,__sectionName:s.restaurantSectionName||''});
    }
    const seen=new Set();
    return out.filter(r=>{const n=orderNum(r);if(!n)return false;if(seen.has(n))return false;seen.add(n);return true});
  }

  function pluginList(payload,ids){
    const list=Array.isArray(payload)?payload:(payload?.plugins||payload?.data||payload?.items||[]);
    const allowed=new Set((ids||[]).map(String));
    return(Array.isArray(list)?list:[]).map(x=>x?.data?{...x,...x.data}:x)
      .filter(x=>x?.pluginId&&allowed.has(String(x.departmentId)))
      .filter(x=>x.online===true);
  }

  function restaurantName(p){
    const r=(state.binding?.restaurants||[]).find(x=>String(x.id)===String(p.departmentId));
    return r?.name||p.restaurantName||'Ресторан';
  }

  function extractHistory(payload){const x=unwrap(payload);const arr=x?.events??x?.data?.events??x?.history??x?.data;return Array.isArray(arr)?arr:[]}
  function eventTitle(e){
    const s=String(e?.pluginEventType??e?.eventType??e?.type??e?.Type??'').toLowerCase();
    if(/neworder|ordercreated/.test(s))return'Заказ создан';
    if(/closingorder|closedorder|orderclosed/.test(s))return'Заказ закрыт';
    if(/payment|orderpayment/.test(s))return'Оплата заказа';
    if(/cancel/.test(s))return'Заказ отменён';
    if(/delete.*item|deletionofprinteditem/.test(s))return'Удалено блюдо';
    if(/additem|addeditem/.test(s))return'Добавлено блюдо';
    if(/discount/.test(s))return'Изменена скидка';
    if(/surcharge|increase/.test(s))return'Изменена надбавка';
    if(/table/.test(s))return'Изменён стол';
    if(/waiter/.test(s))return'Изменён официант';
    return e?.pluginEventType??e?.eventType??e?.type??'Событие';
  }

  function renderItems(d){
    const items=d?.Items??d?.items??[];
    if(!Array.isArray(items)||!items.length)return'<div class="cm-empty">Состав заказа отсутствует.</div>';
    return`<table class="cm-table"><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${items.map(i=>{
      const q=num(i.Amount??i.amount),p=num(i.Price??i.price),s=num(i.ResultSum??i.resultSum??i.Cost??i.cost),sum=Number.isFinite(s)?s:(Number.isFinite(q)&&Number.isFinite(p)?q*p:NaN);
      return`<tr><td><b>${esc(i.Name??i.name??'—')}</b>${i.Size?`<small> · ${esc(i.Size)}</small>`:''}</td><td>${Number.isFinite(q)?q:'—'}</td><td>${money(p)}</td><td>${money(sum)}</td><td>${esc(i.Status??i.status??'—')}</td></tr>`
    }).join('')}</tbody></table>`;
  }

  async function openOrder(plugin,row){
    const modal=document.getElementById('cash-modern-modal');if(!modal)return;
    const n=orderNum(row);modal.classList.add('open');modal.setAttribute('aria-hidden','false');
    document.getElementById('cm-title').textContent=`Заказ #${n}`;
    document.getElementById('cm-subtitle').textContent=`${restaurantName(plugin)} · ${plugin.groupName||'Без группы'} · ${plugin.pluginName||'Касса'}`;
    document.getElementById('cm-details').innerHTML='<div class="cm-empty">Загрузка заказа…</div>';
    document.getElementById('cm-items').innerHTML='';document.getElementById('cm-history').innerHTML='';
    try{
      const body={action:'Order',departmentIds:[String(plugin.departmentId)],pluginId:plugin.pluginId,params:{orderNum:String(n),requestDetail:String(n),RequestDetail:String(n),orderNumber:String(n)}};
      let p=await api('/api/plugin/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      let d=unwrap(p)?.data??unwrap(p)?.orderDetails??unwrap(p)?.order??unwrap(p);
      if(!d||typeof d!=='object'){body.action='get_order';p=await api('/api/plugin/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});d=unwrap(p)?.data??unwrap(p)?.orderDetails??unwrap(p)?.order??unwrap(p)}
      document.getElementById('cm-details').innerHTML=[
        ['Статус',statusText(row)],['Сумма',money(amount(row))],['Стол',row?.orderTables??row?.tables??'—'],['Зал',row?.floor??row?.restaurantSectionName??row?.__sectionName??'—'],
        ['Официант',row?.waiter??'—'],['Открыт',dt(row?.orderOpenDate??row?.openTime??row?.deliveryOpenTime)],['Закрыт',dt(row?.orderCloseTime??row?.closeTime??row?.deliveryDeliveryCloseTime)],['Касса',plugin.pluginName||'—']
      ].map(x=>`<div class="cm-detail"><span>${x[0]}</span><strong>${esc(x[1])}</strong></div>`).join('');
      document.getElementById('cm-items').innerHTML=renderItems(d);
      try{
        const q=new URLSearchParams({pluginId:String(plugin.pluginId),orderNum:String(n),departmentIds:String(plugin.departmentId)});
        const hp=await api(`/api/plugin/order-history?${q.toString()}`);const events=extractHistory(hp);
        document.getElementById('cm-history').innerHTML=events.length?events.slice().reverse().map(e=>`<div class="cm-event"><strong>${esc(eventTitle(e))}</strong><span>${dt(e?.createdAt??e?.timestamp??e?.time)}${e?.data?.name?` · ${esc(e.data.name)}`:''}</span></div>`).join(''):'<div class="cm-empty">История событий не найдена.</div>';
      }catch{document.getElementById('cm-history').innerHTML='<div class="cm-empty">История событий пока недоступна.</div>'}
    }catch(e){document.getElementById('cm-details').innerHTML=`<div class="cm-empty">Не удалось открыть заказ: ${esc(e.message||e)}</div>`}
  }

  function stats(orders){
    const s={closed:0,open:0,other:0,closedSum:0,openSum:0,total:orders.length};
    orders.forEach(r=>{const st=status(r),a=amount(r);if(st==='closed'){s.closed++;if(Number.isFinite(a))s.closedSum+=a}else if(st==='open'){s.open++;if(Number.isFinite(a))s.openSum+=a}else s.other++});
    return s;
  }

  function renderCard(card){
    const f=state.filters.get(card.plugin.pluginId)||'all',q=(state.search.get(card.plugin.pluginId)||'').trim().toLowerCase();
    const list=card.orders.filter(r=>{const s=status(r);if(f!=='all'&&s!==f)return false;if(!q)return true;return[orderNum(r),rawStatus(r),r?.orderTables,r?.tables,r?.waiter,r?.floor,r?.__sectionName].join(' ').toLowerCase().includes(q)});
    const s=stats(card.orders);const el=document.querySelector(`[data-modern-card="${CSS.escape(card.plugin.pluginId)}"]`);if(!el)return;
    el.querySelector('.cash-card-statline').innerHTML=`<span>Закрытые <b>${money(s.closedSum)}</b></span><span>Открытые <b>${money(s.openSum)}</b></span><span class="accent">Ожидаемая <b>${money(s.closedSum+s.openSum)}</b></span><span>Всего <b>${s.total}</b></span>`;
    el.querySelector('.cash-card-count').textContent=`${list.length} из ${card.orders.length}`;
    el.querySelector('.cash-modern-orders tbody').innerHTML=list.map(r=>`<tr class="order-row" data-order="${esc(orderNum(r))}"><td class="order-num">#${esc(orderNum(r))}</td><td><span class="order-status ${status(r)}">${esc(statusText(r))}</span></td><td>${esc(r?.orderTables??r?.tables??'—')}</td><td>${esc(r?.floor??r?.restaurantSectionName??r?.__sectionName??'—')}</td><td>${esc(r?.waiter??'—')}</td><td class="order-amount">${money(amount(r))}</td><td>${esc(dt(r?.orderOpenDate??r?.openTime??r?.deliveryOpenTime))}</td></tr>`).join('')||'<tr><td colspan="7" class="cash-modern-empty">Заказов по выбранному фильтру нет.</td></tr>';
  }

  async function buildCards(host,plugins){
    host.innerHTML=`<div class="cash-network-card"><div class="cash-network-top"><div class="cash-network-title"><span class="eyebrow">СЕТЬ · ОПЕРАТИВНЫЙ КОНТРОЛЬ</span><h1>Операционная касса</h1><p>Общая картина по всем выбранным ресторанам. Ниже — каждая подключённая касса.</p></div><span class="cash-network-badge">● ${plugins.length} ${plural(plugins.length,'касса','кассы','касс')} онлайн</span></div><div class="cash-network-kpis"><div class="cash-network-kpi"><span>Закрытые заказы</span><strong id="net-closed">—</strong><small id="net-closed-count">Загрузка…</small></div><div class="cash-network-kpi"><span>Открытые заказы</span><strong id="net-open">—</strong><small id="net-open-count">Загрузка…</small></div><div class="cash-network-kpi expected"><span>Ожидаемая выручка</span><strong id="net-expected">—</strong><small>закрытые + открытые · выбранные рестораны</small></div><div class="cash-network-kpi"><span>Всего заказов</span><strong id="net-orders">—</strong><small id="net-restaurants">—</small></div></div></div><div class="cash-modern-head"><div><span class="eyebrow">КАССЫ</span><h2>Кассы по ресторанам</h2><p>Выберите статус или найдите заказ. Нажмите строку, чтобы открыть состав и историю.</p></div><span class="cash-selection-note">Учитываются только выбранные рестораны</span></div><div class="cash-cards"><div class="cash-modern-loading">Загружаем заказы всех касс…</div></div>`;

    const results=await Promise.all(plugins.map(async p=>{
      try{
        const payload=await api('/api/plugin/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get_orders',departmentIds:[String(p.departmentId)],pluginId:p.pluginId})});
        return {plugin:p,orders:rows(payload),error:null};
      }catch(error){return {plugin:p,orders:[],error};}
    }));

    state.cards=results.map(x=>({plugin:x.plugin,orders:x.orders}));
    const allOrders=results.flatMap(x=>x.orders), network=stats(allOrders);
    host.querySelector('#net-closed').textContent=money(network.closedSum);
    host.querySelector('#net-open').textContent=money(network.openSum);
    host.querySelector('#net-expected').textContent=money(network.closedSum+network.openSum);
    host.querySelector('#net-orders').textContent=network.total;
    host.querySelector('#net-closed-count').textContent=`${network.closed} ${plural(network.closed,'заказ','заказа','заказов')}`;
    host.querySelector('#net-open-count').textContent=`${network.open} ${plural(network.open,'заказ','заказа','заказов')}`;
    host.querySelector('#net-restaurants').textContent=`${new Set(plugins.map(x=>String(x.departmentId))).size} ${plural(new Set(plugins.map(x=>String(x.departmentId))).size,'ресторан','ресторана','ресторанов')}`;

    const cardsEl=host.querySelector('.cash-cards');cardsEl.innerHTML='';
    results.forEach(({plugin,orders,error})=>{
      const el=document.createElement('article');el.className='cash-modern-card';el.dataset.modernCard=plugin.pluginId;
      el.innerHTML=`<div class="cash-modern-card-head"><div class="cash-modern-card-title"><div><span class="section-kicker">${esc(restaurantName(plugin))}</span><h3>${esc(plugin.groupName||'Без группы')}</h3><p>${esc(plugin.pluginName||'Касса')} · подключена</p></div><span class="cash-cash-status">● Онлайн</span></div><div class="cash-card-statline"></div></div><div class="cash-order-tools"><input class="cash-order-search" type="search" placeholder="Поиск заказа…"><div class="cash-order-filters"><button class="active" data-f="all">Все</button><button data-f="open">Открытые</button><button data-f="closed">Закрытые</button><button data-f="other">Другие</button></div></div><div class="cash-modern-orders"><table><thead><tr><th>Заказ</th><th>Статус</th><th>Стол</th><th>Зал</th><th>Официант</th><th>Сумма</th><th>Открыт</th></tr></thead><tbody></tbody></table></div><div class="cash-modern-footer"><span>Показано <b class="cash-card-count">0 из 0</b></span>${error?`<span class="cash-card-error">Не удалось обновить данные: ${esc(error.message||error)}</span>`:''}</div>`;
      cardsEl.appendChild(el);state.filters.set(plugin.pluginId,'all');state.search.set(plugin.pluginId,'');
      const card=state.cards.find(x=>x.plugin.pluginId===plugin.pluginId);
      el.querySelector('.cash-order-search').addEventListener('input',e=>{state.search.set(plugin.pluginId,e.target.value);renderCard(card)});
      el.querySelectorAll('[data-f]').forEach(b=>b.addEventListener('click',()=>{el.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.filters.set(plugin.pluginId,b.dataset.f);renderCard(card)}));
      el.querySelector('.cash-modern-orders tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-order]');if(!tr)return;const row=card.orders.find(r=>orderNum(r)===tr.dataset.order);if(row)openOrder(plugin,row)});
      renderCard(card);
    });
  }

  async function load(){
    const host=document.getElementById('cash-modern');if(!host)return;
    host.innerHTML='<div class="cash-network-card"><div class="cash-modern-empty">Загрузка выбранных ресторанов и касс…</div></div>';
    try{
      state.binding=await binding();
      if(!state.binding.departmentIds?.length){host.innerHTML='<div class="cash-network-card"><div class="cash-modern-empty">Подключите iiko Server в Настройках.</div></div>';return}
      const qs=new URLSearchParams({departmentIds:state.binding.departmentIds.join(',')});
      const payload=await api(`/api/plugin/data?${qs.toString()}`);const plugins=pluginList(payload,state.binding.departmentIds);
      if(!plugins.length){host.innerHTML='<div class="cash-network-card"><div class="cash-modern-empty">Для выбранных ресторанов сейчас нет онлайн-касс.</div></div>';return}
      await buildCards(host,plugins);
      const stamp=document.createElement('div');stamp.className='cash-last-updated';stamp.textContent=`Обновлено ${new Date().toLocaleTimeString('ru-RU')}`;host.appendChild(stamp);
    }catch(e){host.innerHTML=`<div class="cash-network-card"><div class="cash-modern-error">${esc(e.message||e)}</div></div>`}
  }

  function init(){
    const host=document.getElementById('cash-modern');if(!host)return;
    const modal=document.getElementById('cash-modern-modal');
    modal?.querySelector('.cm-close')?.addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')});
    modal?.querySelector('.cm-backdrop')?.addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal?.classList.contains('open')){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}});
    load();
    window.addEventListener('sh:iiko-selection-changed',load);
    window.addEventListener('sh:iiko-context-changed',load);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
