(() => {
  const boot = () => {
    const app = document.querySelector('.app-content');
    const shift = document.querySelector('.shift-summary-panel');
    const request = document.querySelector('.request-panel');
    const connected = document.querySelector('.connected-panel');
    const resultPanel = document.querySelector('.result-panel');
    const resultSummary = document.getElementById('result-summary');
    const resultOutput = document.getElementById('result-output');
    const action = document.getElementById('action-select');
    if (!app || !shift || !request || !resultPanel || !resultSummary || !resultOutput) return;

    if (action) {
      action.value = 'get_orders';
      action.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (connected) connected.style.display = 'none';
    if (request) request.style.display = 'none';
    const pageHead = app.querySelector('.page-head');
    if (pageHead) pageHead.style.display = 'none';

    // Keep the technical result container alive for the existing request/order logic,
    // but remove it completely from the visible layout. Only result-summary is shown.
    resultPanel.style.display = 'none';
    resultPanel.querySelector('.cash-overview-grid')?.remove();
    resultPanel.querySelector('.panel-head')?.remove();

    let shell = document.getElementById('cash-dashboard-shell');
    if (!shell) {
      shell = document.createElement('section');
      shell.id = 'cash-dashboard-shell';
      shell.className = 'cash-dashboard-shell';
      app.insertBefore(shell, app.firstChild);
    }

    if (shift.parentElement !== shell) shell.appendChild(shift);

    let visibleResult = document.getElementById('cash-visible-result');
    if (!visibleResult) {
      visibleResult = document.createElement('section');
      visibleResult.id = 'cash-visible-result';
      visibleResult.className = 'cash-visible-result';
      shell.appendChild(visibleResult);
    }
    if (resultSummary.parentElement !== visibleResult) visibleResult.appendChild(resultSummary);

    let payments = document.getElementById('cash-payments-summary');
    if (!payments) {
      payments = document.createElement('section');
      payments.id = 'cash-payments-summary';
      payments.className = 'cash-payments-summary';
      payments.innerHTML = `
        <div class="cash-section-heading">
          <div><span>ОПЛАТЫ</span><strong>Закрытые заказы по типам оплаты</strong></div>
          <em id="cash-payment-total">—</em>
        </div>
        <div class="cash-payment-grid" id="cash-payment-grid">
          <div class="cash-payment-empty">Загружаем данные оплат…</div>
        </div>`;
      visibleResult.insertBefore(payments, resultSummary);
    }

    let ordersHeading = document.getElementById('cash-orders-heading');
    if (!ordersHeading) {
      ordersHeading = document.createElement('div');
      ordersHeading.id = 'cash-orders-heading';
      ordersHeading.className = 'cash-section-heading cash-orders-heading';
      ordersHeading.innerHTML = `<div><span>ЗАКАЗЫ</span><strong>Все заказы кассы</strong></div><em>● LIVE</em>`;
      visibleResult.insertBefore(ordersHeading, resultSummary);
    }

    const style = document.createElement('style');
    style.id = 'cash-dashboard-clean-style';
    style.textContent = `
      .app-content{max-width:1400px!important;padding:18px 18px 32px!important}
      #cash-dashboard-shell{width:100%;max-width:1400px;margin:0 auto;border:1px solid #233142;border-radius:20px;background:linear-gradient(180deg,#0f1721 0%,#0b1219 100%);box-shadow:0 18px 55px rgba(0,0,0,.22);overflow:hidden}
      #cash-dashboard-shell>.panel{margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}
      #cash-dashboard-shell>.shift-summary-panel{padding:20px 22px!important;background:#101923!important;border-bottom:1px solid #233142!important}
      #cash-dashboard-shell .panel-head{padding:0!important;margin:0 0 12px!important;border:0!important}
      #cash-dashboard-shell .panel-title{font-size:15px!important}
      #cash-dashboard-shell .panel-muted{font-size:10px!important}
      .shift-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important}
      .shift-summary-card{min-height:100px!important;padding:15px 16px!important;border-radius:13px!important;background:#121d28!important}
      .shift-summary-card strong{font-size:27px!important;line-height:1.1!important;margin-top:8px!important}
      .shift-summary-card small{font-size:9px!important}
      #cash-visible-result{padding:20px 22px 24px!important}
      .cash-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin:0 0 10px!important}
      .cash-section-heading span{display:block;color:#718294;font-size:8px;font-weight:900;letter-spacing:.14em;margin-bottom:3px}
      .cash-section-heading strong{display:block;color:#f4f7fa;font-size:14px;font-weight:850}
      .cash-section-heading em{font-style:normal;color:#42d392;font-size:9px;font-weight:800;white-space:nowrap}
      .cash-payments-summary{margin:0 0 20px!important;padding:15px 16px!important;border:1px solid #233142;border-radius:13px;background:#101923}
      .cash-payment-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
      .cash-payment-card{min-width:0;padding:11px 12px;border:1px solid #263646;border-radius:10px;background:#121c27}
      .cash-payment-card .name{font-size:9px;color:#91a0af;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cash-payment-card .amount{font-size:17px;color:#f4f7fa;font-weight:850;margin-top:4px}
      .cash-payment-card .meta{font-size:8px;color:#667788;margin-top:3px}
      .cash-payment-bar{height:4px;margin-top:8px;border-radius:99px;background:#202c39;overflow:hidden}
      .cash-payment-bar i{display:block;height:100%;border-radius:99px;background:#42d392}
      .cash-payment-empty{font-size:10px;color:#718294;padding:5px 0}
      .cash-orders-heading{margin-top:2px!important}
      #result-summary{margin:0!important;padding:0!important;border:0!important;background:transparent!important;min-height:0!important;height:auto!important}
      #result-summary .orders-dashboard{margin:0!important;padding:0!important;min-height:0!important;height:auto!important}
      #result-summary .orders-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important;margin:0 0 11px!important}
      #result-summary .order-stat{min-height:64px!important;padding:10px 12px!important;border-radius:10px!important;background:#121c27!important}
      #result-summary .order-stat strong{font-size:19px!important}
      #result-summary .orders-toolbar{margin:0 0 7px!important;padding:0 1px!important}
      #result-summary .orders-table-wrap{border:1px solid #233142!important;border-radius:12px!important;background:#0f1822!important;padding:5px!important;max-height:none!important;overflow:auto!important}
      #result-summary .orders-table{width:100%!important;table-layout:auto!important;border-spacing:0!important}
      #result-summary .orders-table thead th{padding:9px 10px!important;background:#111b26!important;border-bottom:1px solid #263646!important;font-size:8px!important;white-space:nowrap!important}
      #result-summary .orders-table tbody tr{height:44px!important}
      #result-summary .orders-table tbody td{padding:7px 10px!important;background:#0f1822!important;border-bottom:1px solid #1d2a38!important;font-size:10px!important;white-space:nowrap!important}
      #result-summary .orders-table tbody tr:hover td{background:#13221f!important}
      #result-summary .orders-table th:nth-child(4),#result-summary .orders-table td:nth-child(4),#result-summary .orders-table th:nth-child(6),#result-summary .orders-table td:nth-child(6),#result-summary .orders-table th:nth-child(9),#result-summary .orders-table td:nth-child(9){display:none!important}
      #result-summary .order-state{font-size:8px!important;padding:4px 7px!important}
      #result-summary .order-open-link{font-size:8px!important}
      #result-summary .table-note{padding:8px 2px!important}
      @media(max-width:1000px){.shift-summary-grid{grid-template-columns:1fr!important}.cash-payment-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media(max-width:650px){#cash-visible-result{padding:14px!important}.cash-payment-grid{grid-template-columns:1fr!important}#result-summary .orders-stats{grid-template-columns:1fr 1fr!important}#result-summary .orders-table{min-width:720px!important}}
    `;
    if (!document.getElementById('cash-dashboard-clean-style')) document.head.appendChild(style);

    const parseMoney = value => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value == null) return NaN;
      const n = Number(String(value).replace(/\s/g,'').replace(/[^0-9,.-]/g,'').replace(',','.'));
      return Number.isFinite(n) ? n : NaN;
    };
    const scalar = value => {
      if (value == null || value === '') return null;
      if (typeof value !== 'object') return value;
      if (Array.isArray(value)) { for (const x of value) { const v=scalar(x); if(v!=null&&v!=='') return v; } return null; }
      for (const k of ['name','title','value','number','code','id']) { const v=scalar(value[k]); if(v!=null&&v!=='') return v; }
      return null;
    };
    const deep = (obj,names,d=0) => {
      if(obj==null||typeof obj!=='object'||d>12)return null;
      const wanted=names.map(x=>x.toLowerCase());
      if(Array.isArray(obj)){for(const x of obj){const v=deep(x,names,d+1);if(v!=null&&v!=='')return v;}return null;}
      for(const [k,v] of Object.entries(obj)) if(wanted.includes(k.toLowerCase())&&v!=null&&v!=='') return v;
      for(const v of Object.values(obj)){const x=deep(v,names,d+1);if(x!=null&&x!=='')return x;}
      return null;
    };
    const orderRows = value => {
      const out=[];
      const walk=(v,d=0)=>{
        if(v==null||d>12||typeof v!=='object')return;
        if(Array.isArray(v)){for(const x of v)walk(x,d+1);return;}
        if(deep(v,['orderNum','orderNumber'])!=null){out.push(v);return;}
        for(const x of Object.values(v))walk(x,d+1);
      };
      walk(value); return out;
    };
    const orderState = row => {
      const s=String(scalar(deep(row,['orderStatus','status','state','orderState','statusName']))??'').toLowerCase();
      if(/closed|close|completed|complete|paid|закрыт|оплачен|заверш/.test(s))return 'closed';
      if(/open|opened|active|new|bill|открыт|актив|новый|пречек/.test(s))return 'open';
      const c=deep(row,['isClosed','closed','isClosedOrder']);
      if(c===true||String(c).toLowerCase()==='true')return 'closed';
      if(c===false||String(c).toLowerCase()==='false')return 'open';
      return deep(row,['closeTime','closedAt','closingTime','closeDate'])?'closed':'unknown';
    };
    const paymentName = p => {
      const direct=scalar(deep(p,['paymentTypeName','paymentType','paymentMethod','paymentName','payTypeName','payType']));
      if(direct)return String(direct);
      const t=String(scalar(p?.type??p?.Type)??'').toLowerCase();
      if(/cash|налич/.test(t))return 'Наличные';
      if(/card|карта|bank|банков|terminal|терминал/.test(t))return 'Карта';
      return null;
    };
    const updatePayments = () => {
      const grid=document.getElementById('cash-payment-grid');
      const totalEl=document.getElementById('cash-payment-total');
      if(!grid)return;
      let payload={};
      try{payload=JSON.parse(resultOutput.textContent||'{}');}catch(_){return;}
      let data=payload?.data;
      if(typeof data==='string'){try{data=JSON.parse(data);}catch(_) {}}
      const map=new Map(); let total=0;
      for(const row of orderRows(data)){
        if(orderState(row)!=='closed')continue;
        const amount=parseMoney(scalar(deep(row,['orderExpectedRevenue','revenue','resultSum','orderSum','sum','total','amount'])));
        if(!Number.isFinite(amount))continue;
        let payments=deep(row,['Payments','payments','payment']);
        if(!Array.isArray(payments))payments=[row];
        const names=[];
        for(const p of payments){const n=paymentName(p);if(n&&!names.includes(n))names.push(n);}
        if(!names.length)names.push('Не определено');
        const share=amount/names.length;
        names.forEach(n=>map.set(n,(map.get(n)||0)+share));
        total+=amount;
      }
      totalEl.textContent=Number.isFinite(total)?`${total.toLocaleString('ru-RU',{maximumFractionDigits:2})} AZN`:'—';
      if(!map.size){grid.innerHTML='<div class="cash-payment-empty">Типы оплаты пока не определены в данных кассы.</div>';return;}
      const list=[...map.entries()].sort((a,b)=>b[1]-a[1]);
      const max=Math.max(...list.map(x=>x[1]),1);
      grid.innerHTML=list.slice(0,6).map(([name,amount])=>{const pct=total?amount/total*100:0;return `<div class="cash-payment-card"><div class="name">${String(name).replaceAll('<','&lt;')}</div><div class="amount">${amount.toLocaleString('ru-RU',{maximumFractionDigits:2})}</div><div class="meta">AZN · ${pct.toFixed(0)}% от закрытых</div><div class="cash-payment-bar"><i style="width:${Math.max(2,amount/max*100)}%"></i></div></div>`}).join('');
    };

    const observer = new MutationObserver(updatePayments);
    observer.observe(resultOutput,{childList:true,characterData:true,subtree:true});
    setInterval(updatePayments,1500);
    updatePayments();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();