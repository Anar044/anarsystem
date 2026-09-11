(() => {
  'use strict';

  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const unwrap = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };
  const num = v => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n) ? n : NaN;
  };
  const money = v => { const n=num(v); return Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; };
  const dt = v => { if (!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
  const status = r => {
    const s=String(r?.orderStatus ?? r?.deliveryOrderStatus ?? '').toLowerCase();
    if (/deleted|cancelled|canceled|отмен|удал/.test(s)) return 'other';
    if (['closed','paid','закрыт','закрыто'].includes(s) || r?.orderCloseTime || r?.closeTime) return 'closed';
    if (['new','bill','open','opened','открыт','открыто','новый'].includes(s)) return 'open';
    return 'other';
  };
  const statusText = r => status(r)==='closed'?'Закрыт':status(r)==='open'?'Открыт':String(r?.orderStatus ?? r?.deliveryOrderStatus ?? 'Другой');
  const amount = r => num(r?.orderExpectedRevenue ?? r?.revenue ?? r?.resultSum ?? r?.orderSum);
  const orderNum = r => String(r?.orderNum ?? r?.number ?? '');

  async function getBinding() {
    const b = await window.SH_IikoContext?.getBinding?.();
    return b || { departmentIds: [] };
  }

  function extractRows(payload) {
    const root=unwrap(payload)?.data ?? unwrap(payload) ?? {};
    const out=[];
    for (const g of (Array.isArray(root.terminalsGroups)?root.terminalsGroups:[])) {
      for (const s of (Array.isArray(g?.restaurantSections)?g.restaurantSections:[])) {
        for (const r of (Array.isArray(s.orders)?s.orders:[])) out.push({...r,__sectionName:s.restaurantSectionName||''});
        for (const r of (Array.isArray(s.deliveries)?s.deliveries:[])) out.push({...r,__sectionName:s.restaurantSectionName||''});
        for (const x of (Array.isArray(s.reserves)?s.reserves:[])) if (x?.reserveOrder) out.push({...x.reserveOrder,__sectionName:s.restaurantSectionName||''});
      }
    }
    return out;
  }

  async function api(path, init) {
    const r=await fetch(path,{cache:'no-store',...(init||{})});
    const text=await r.text(); let data;
    try { data=JSON.parse(text); } catch { throw Error(`HTTP ${r.status}: ответ не JSON`); }
    if (!r.ok || data?.success===false && data?.error) throw Error(data?.error || `HTTP ${r.status}`);
    return unwrap(data);
  }

  function normalizePlugins(payload, departmentIds) {
    let list=Array.isArray(payload)?payload:(payload?.plugins||payload?.data||payload?.items||[]);
    if (!Array.isArray(list)) list=[];
    const allowed=new Set((departmentIds||[]).map(String).map(x=>x.trim().toLowerCase()).filter(Boolean));
    return list
      .map(x => x?.data ? {...x,...x.data} : x)
      .filter(x => x?.pluginId)
      // Defense in depth: even if a proxy/upstream accidentally returns
      // unrelated plugins, never render one outside this user's Department.
      .filter(x => allowed.has(String(x?.departmentId||'').trim().toLowerCase()))
      // A group is shown only while a real Plugin from that group is online.
      .filter(x => x?.online === true);
  }

  function stats(rows) {
    let closed=0, open=0, other=0, closedSum=0, openSum=0;
    for (const r of rows) {
      const s=status(r), a=amount(r);
      if (s==='closed') { closed++; if(Number.isFinite(a)) closedSum+=a; }
      else if(s==='open') { open++; if(Number.isFinite(a)) openSum+=a; }
      else other++;
    }
    return {closed,open,other,closedSum,openSum,total:rows.length};
  }

  function renderGroup(plugin, rows) {
    const s=stats(rows);
    const name=plugin.groupName || 'Без группы';
    const machine=plugin.pluginName || plugin.pluginId;
    const orders=rows.slice().sort((a,b)=>{
      const da=new Date(a?.orderOpenDate ?? a?.openTime ?? 0).getTime();
      const db=new Date(b?.orderOpenDate ?? b?.openTime ?? 0).getTime();
      return db-da;
    });
    const rowsHtml=orders.slice(0,100).map(r=>`<tr>
      <td class="order-num">#${esc(orderNum(r))}</td>
      <td><span class="order-status ${status(r)}">${esc(statusText(r))}</span></td>
      <td>${esc(r?.orderTables ?? r?.tables ?? '—')}</td>
      <td>${esc(r?.floor ?? r?.restaurantSectionName ?? r?.__sectionName ?? '—')}</td>
      <td>${esc(r?.waiter ?? '—')}</td>
      <td class="order-amount">${money(amount(r))}</td>
      <td>${esc(dt(r?.orderOpenDate ?? r?.openTime ?? r?.deliveryOpenTime))}</td>
      <td>${esc(dt(r?.orderCloseTime ?? r?.closeTime ?? r?.deliveryDeliveryCloseTime))}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-state">Заказы в этой группе не найдены.</td></tr>';

    return `<article class="cash-card cash-group-card" data-group-plugin="${esc(plugin.pluginId)}">
      <div class="cash-group-head">
        <div>
          <span class="section-kicker">ГРУППА</span>
          <h2>${esc(name)}</h2>
          <p>${esc(machine)} · Department: ${esc(plugin.departmentId || '—')}</p>
        </div>
        <div class="cash-group-status online">● Онлайн</div>
      </div>
      <div class="cash-group-kpis">
        <div><span>Закрытые</span><strong>${money(s.closedSum)}</strong><small>${s.closed} заказов</small></div>
        <div><span>Открытые</span><strong>${money(s.openSum)}</strong><small>${s.open} заказов</small></div>
        <div><span>Ожидаемая выручка</span><strong>${money(s.closedSum+s.openSum)}</strong><small>закрытые + открытые</small></div>
        <div><span>Всего заказов</span><strong>${s.total}</strong><small>${s.other} других</small></div>
      </div>
      <div class="cash-group-meta">
        <span>Plugin ID: ${esc(plugin.pluginId)}</span>
        <span>Group ID: ${esc(plugin.groupId || '—')}</span>
        <span>Последнее событие: ${esc(dt(plugin.lastEventAt))}</span>
      </div>
      <div class="cash-group-orders">
        <div class="card-head"><div><span class="section-kicker">ЗАКАЗЫ</span><h3>Данные этой группы</h3></div><span class="card-total">${s.total}</span></div>
        <div class="table-wrap"><table class="orders-table"><thead><tr><th>Заказ</th><th>Статус</th><th>Стол</th><th>Зал</th><th>Официант</th><th>Сумма</th><th>Открыт</th><th>Закрыт</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
        ${orders.length>100?`<div class="orders-footer">Показаны первые 100 заказов из ${orders.length}.</div>`:''}
      </div>
    </article>`;
  }

  async function load() {
    const host=document.getElementById('cash-groups');
    if(!host) return;
    host.innerHTML='<div class="cash-card"><div class="empty-state">Загрузка подключённых касс…</div></div>';
    try {
      const binding=await getBinding();
      if(!binding.departmentIds?.length) {
        host.innerHTML='<div class="cash-card"><div class="empty-state">Department ID не найден. Подключите iiko Server в Настройках.</div></div>';
        return;
      }
      const qs=new URLSearchParams({departmentIds:binding.departmentIds.join(',')});
      const payload=await api(`/api/plugin/data?${qs.toString()}`);
      const plugins=normalizePlugins(payload,binding.departmentIds);
      if(!plugins.length) {
        host.innerHTML='<div class="cash-card"><div class="empty-state">Сейчас нет отвечающих Plugin для текущего Department ID.</div></div>';
        return;
      }
      const sections=[];
      for(const plugin of plugins) {
        try {
          const body={action:'get_orders',departmentIds:binding.departmentIds,pluginId:plugin.pluginId};
          const orderPayload=await api('/api/plugin/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          sections.push(renderGroup(plugin,extractRows(orderPayload)));
        } catch(error) {
          sections.push(renderGroup(plugin,[]).replace('</article>',`<div class="cash-group-error">Не удалось получить текущие заказы этой кассы: ${esc(error.message||error)}</div></article>`));
        }
      }
      host.innerHTML=sections.join('');
      const stamp=document.getElementById('cash-groups-updated');
      if(stamp) stamp.textContent=`Обновлено ${new Date().toLocaleTimeString('ru-RU')}`;
    } catch(error) {
      host.innerHTML=`<div class="cash-card"><div class="error-cell">${esc(error.message||error)}</div></div>`;
    }
  }

  function init() {
    const page=document.querySelector('.cash-page');
    if(!page) return;
    if(document.getElementById('cash-groups')) return;
    const wrap=document.createElement('section');
    wrap.className='cash-groups-section';
    wrap.innerHTML=`<div class="cash-groups-title"><div><span class="eyebrow">КАССЫ · DEPARTMENT</span><h2>Все подключённые кассы</h2><p>Показываем все Plugin, у которых Department ID совпадает с подключённым рестораном. Group используется только для разделения данных.</p></div><span id="cash-groups-updated" class="cash-groups-updated">Загрузка…</span></div><div id="cash-groups" class="cash-groups"></div>`;
    page.insertBefore(wrap,page.firstElementChild?.nextSibling || page.firstChild);
    load();
    window.addEventListener('iiko-state-changed',load);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
