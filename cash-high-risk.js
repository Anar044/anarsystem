(() => {
  'use strict';

  const esc = v => String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  const unwrap = v => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };

  const scalar = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      for (const x of v) { const s = scalar(x); if (s) return s; }
      return null;
    }
    if (typeof v === 'object') {
      for (const k of ['name','Name','fullName','FullName','displayName','DisplayName','title','Title','value','Value','text','Text']) {
        const s = scalar(v[k]);
        if (s) return s;
      }
    }
    return null;
  };

  const deep = (obj, names, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    const wanted = names.map(x => String(x).toLowerCase());
    for (const [k,v] of Object.entries(obj)) {
      if (wanted.includes(k.toLowerCase())) {
        const s = scalar(v);
        if (s) return s;
      }
    }
    for (const v of Object.values(obj)) {
      const s = deep(v, names, depth + 1);
      if (s) return s;
    }
    return null;
  };

  const dt = v => {
    if (!v) return 'Время не указано';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('ru-RU', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  };

  const money = v => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n)
      ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₼'
      : String(v);
  };

  const state = {
    plugins: new Map(),
    current: null
  };

  function rememberRequest(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!url.includes('/api/plugin/request') || !init?.body || typeof init.body !== 'string') return;
      const body = JSON.parse(init.body);
      if (!body?.pluginId) return;
      const id = String(body.pluginId);
      state.plugins.set(id, {
        pluginId: id,
        departmentId: body.departmentIds?.[0] ?? body.departmentId ?? '',
        pluginName: body.pluginName ?? '',
        groupId: body.groupId ?? '',
        groupName: body.groupName ?? ''
      });
    } catch (_) {}
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    rememberRequest(input, init);
    return originalFetch(input, init);
  };

  function installStyle() {
    if (document.getElementById('cash-high-risk-style')) return;
    const style = document.createElement('style');
    style.id = 'cash-high-risk-style';
    style.textContent = `
      .cash-risk-btn{border:1px solid rgba(239,116,116,.24);background:rgba(239,116,116,.07);color:#f0a0a0;border-radius:8px;padding:7px 10px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap}
      .cash-risk-btn:hover{background:rgba(239,116,116,.13);border-color:rgba(239,116,116,.4);color:#ffb4b4}
      .cash-risk-count{display:inline-flex;min-width:17px;height:17px;padding:0 4px;align-items:center;justify-content:center;border-radius:6px;background:rgba(239,116,116,.16);font-size:9px}
      #cash-risk-modal{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;padding:20px}
      #cash-risk-modal.open{display:flex}.crm-backdrop{position:absolute;inset:0;background:rgba(3,7,11,.76);backdrop-filter:blur(6px)}
      .crm-dialog{position:relative;width:min(1080px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#111923;box-shadow:0 25px 80px rgba(0,0,0,.55)}
      .crm-head{display:flex;justify-content:space-between;gap:15px;padding:20px 22px;border-bottom:1px solid rgba(255,255,255,.07)}
      .crm-kicker{color:#ef8d8d;font-size:9px;letter-spacing:.12em}.crm-head h2{margin:5px 0 3px;font-size:20px}.crm-head p{margin:0;color:#7d8998;font-size:11px}
      .crm-close{width:34px;height:34px;border:0;border-radius:9px;background:#1a2531;color:#d9e1e9;font-size:20px;cursor:pointer}
      .crm-body{padding:18px 22px}.crm-summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.crm-pill{padding:7px 10px;border-radius:8px;background:#0d151e;color:#8795a4;font-size:10px}.crm-pill b{color:#eef3f7}
      .crm-list{display:grid;gap:8px}.crm-item{display:grid;grid-template-columns:145px 1fr;gap:14px;padding:13px;border:1px solid rgba(255,255,255,.055);border-radius:11px;background:#0d151e}
      .crm-time{color:#8b98a7;font-size:10px;font-variant-numeric:tabular-nums}.crm-main strong{display:block;color:#edf2f6;font-size:11px}.crm-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.crm-meta span{padding:4px 7px;border-radius:6px;background:#151f29;color:#8d9baa;font-size:9px}.crm-meta b{color:#d9e1e8}
      .crm-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.crm-detail{padding:4px 7px;border-radius:6px;background:#151f29;color:#a1adba;font-size:9px}.crm-empty{padding:22px;border-radius:10px;background:#0d151e;color:#718092;font-size:10px;text-align:center}
      @media(max-width:650px){.crm-item{grid-template-columns:1fr;gap:7px}.crm-body{padding:15px}.crm-head{padding:16px}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if (document.getElementById('cash-risk-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'cash-risk-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `
      <div class="crm-backdrop"></div>
      <section class="crm-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-title">
        <header class="crm-head">
          <div><span class="crm-kicker">КОНТРОЛЬ КАССЫ</span><h2 id="crm-title">Опасные операции</h2><p id="crm-subtitle">Загрузка…</p></div>
          <button class="crm-close" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="crm-body"><div id="crm-summary" class="crm-summary"></div><div id="crm-list" class="crm-list"></div></div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target.closest('.crm-close') || e.target.classList.contains('crm-backdrop')) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  function closeModal() {
    const m = document.getElementById('cash-risk-modal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden','true');
  }

  function operationType(x) {
    return String(deep(x,['operationName','operationTypeName','operationType','highRiskOperation','eventName','eventType','type','Type','name','Name']) || 'Опасная операция');
  }

  function operationActor(x) {
    return deep(x,['employeeName','employeeFullName','employee','employeeInfo','userName','userFullName','user','operatorName','operatorFullName','operator','cashierName','cashierFullName','cashier','waiterName','waiterFullName','waiter','authorName','authorFullName','author','createdBy','performedBy','changedBy','modifiedBy']);
  }

  function operationOrder(x) {
    return deep(x,['orderNumber','orderNum','number','OrderNumber','OrderNum']);
  }

  function operationTime(x) {
    return x?.receivedAt ?? x?.createdAt ?? x?.timestamp ?? x?.time ?? x?.dateTime ?? x?.eventAt ?? x?.createdDate;
  }

  function details(x) {
    const out = [];
    const d = x?.data && typeof x.data === 'object' ? x.data : x;
    const item = deep(d,['itemName','productName','dishName','menuItemName']);
    const qty = deep(d,['quantity','amount','itemAmount','count']);
    const sum = deep(d,['resultSum','itemSum','sum','total','revenue','amountSum']);
    const table = deep(d,['tableName','table','orderTables']);
    const floor = deep(d,['floorName','floor','restaurantSection','hall']);
    const payment = deep(d,['paymentTypeName','paymentName','paymentMethod','paymentType']);
    const reason = deep(d,['reason','reasonName','comment','description','details']);
    if(item) out.push(`Блюдо: ${item}`);
    if(qty) out.push(`Количество: ${qty}`);
    if(sum) out.push(`Сумма: ${money(sum)}`);
    if(table) out.push(`Стол: ${scalar(table) ?? table}`);
    if(floor) out.push(`Зал: ${scalar(floor) ?? floor}`);
    if(payment) out.push(`Оплата: ${scalar(payment) ?? payment}`);
    if(reason) out.push(`Причина: ${scalar(reason) ?? reason}`);
    return out;
  }

  function findOperations(payload) {
    const root = unwrap(payload);
    const candidates = [];
    const keys = ['highRiskOperations','HighRiskOperations','operations','Operations','events','Events','items','Items','history','History'];
    const visit = (obj, depth=0) => {
      if (!obj || typeof obj !== 'object' || depth > 5) return;
      if (Array.isArray(obj)) {
        if (obj.length && obj.some(x => x && typeof x === 'object')) candidates.push(obj);
        return;
      }
      for (const k of keys) if (Array.isArray(obj[k])) candidates.push(obj[k]);
      for (const v of Object.values(obj)) if (v && typeof v === 'object') visit(v, depth+1);
    };
    visit(root);
    const best = candidates.sort((a,b)=>b.length-a.length)[0] || [];
    return best;
  }

  function renderOperations(plugin, payload) {
    const ops = findOperations(payload);
    const title = document.getElementById('crm-title');
    const subtitle = document.getElementById('crm-subtitle');
    const summary = document.getElementById('crm-summary');
    const list = document.getElementById('crm-list');
    title.textContent = 'Опасные операции';
    subtitle.textContent = `${plugin.pluginName || 'Касса'} · ${plugin.groupName || 'Без группы'}`;
    summary.innerHTML = `<span class="crm-pill">Найдено: <b>${ops.length}</b></span><span class="crm-pill">Касса: <b>${esc(plugin.pluginName || '—')}</b></span>`;
    if (!ops.length) {
      list.innerHTML = '<div class="crm-empty">Опасных операций не найдено.</div>';
      return;
    }
    const ordered = ops.slice().sort((a,b)=>{
      const ta = new Date(operationTime(a) || 0).getTime();
      const tb = new Date(operationTime(b) || 0).getTime();
      return (Number.isFinite(tb)?tb:0) - (Number.isFinite(ta)?ta:0);
    });
    list.innerHTML = ordered.map(x=>{
      const who = operationActor(x) || 'не указан в событии';
      const ord = operationOrder(x);
      const extra = details(x);
      return `<article class="crm-item"><div class="crm-time">${esc(dt(operationTime(x)))}</div><div class="crm-main"><strong>${esc(operationType(x))}</strong><div class="crm-meta"><span><b>Сотрудник:</b> ${esc(who)}</span>${ord?`<span><b>Заказ:</b> #${esc(ord)}</span>`:''}</div>${extra.length?`<div class="crm-details">${extra.map(v=>`<span class="crm-detail">${esc(v)}</span>`).join('')}</div>`:''}</div></article>`;
    }).join('');
  }

  async function openRisk(pluginId) {
    const plugin = state.plugins.get(String(pluginId)) || {pluginId:String(pluginId)};
    const modal = document.getElementById('cash-risk-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    document.getElementById('crm-title').textContent='Опасные операции';
    document.getElementById('crm-subtitle').textContent=`${plugin.pluginName || 'Касса'} · ${plugin.groupName || 'Загрузка…'}`;
    document.getElementById('crm-summary').innerHTML='';
    document.getElementById('crm-list').innerHTML='<div class="crm-empty">Запрашиваем список операций…</div>';
    try {
      const body = {
        action:'HighRiskOperations',
        pluginId:plugin.pluginId,
        departmentIds:plugin.departmentId ? [String(plugin.departmentId)] : undefined,
        groupId:plugin.groupId || undefined,
        groupName:plugin.groupName || undefined
      };
      const r = await originalFetch('/api/plugin/request', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), cache:'no-store'
      });
      const text = await r.text();
      let data; try { data=JSON.parse(text); } catch { throw Error(`HTTP ${r.status}: ответ не JSON`); }
      if(!r.ok || data?.success===false && data?.error) throw Error(data?.error || `HTTP ${r.status}`);
      renderOperations(plugin,data);
    } catch(e) {
      document.getElementById('crm-list').innerHTML=`<div class="crm-empty">Не удалось получить список опасных операций: ${esc(e.message || e)}</div>`;
    }
  }

  function addButtons() {
    document.querySelectorAll('.cash-modern-card[data-modern-card]').forEach(card => {
      if (card.querySelector('.cash-risk-btn')) return;
      const pluginId = card.getAttribute('data-modern-card');
      if (!pluginId) return;
      const head = card.querySelector('.cash-modern-card-head');
      if (!head) return;
      const title = head.querySelector('.cash-modern-card-title');
      if (!title) return;
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='cash-risk-btn';
      btn.innerHTML='⚠ Опасные операции';
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openRisk(pluginId); });
      title.appendChild(btn);
    });
  }

  function init() {
    installStyle();
    ensureModal();
    addButtons();
    const observer = new MutationObserver(addButtons);
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
