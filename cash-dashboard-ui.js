(() => {
  const boot = () => {
    const app = document.querySelector('.app-content');
    const shift = document.querySelector('.shift-summary-panel');
    const connected = document.querySelector('.connected-panel');
    const request = document.querySelector('.request-panel');
    const result = document.querySelector('.result-panel');
    const resultSummary = document.getElementById('result-summary');
    const action = document.getElementById('action-select');
    if (!app || !shift || !request || !result || !resultSummary) return;

    if (action) {
      action.value = 'get_orders';
      action.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (connected) connected.style.display = 'none';
    if (request) request.style.display = 'none';
    const head = app.querySelector('.page-head');
    if (head) head.style.display = 'none';

    let shell = document.getElementById('cash-dashboard-shell');
    if (!shell) {
      shell = document.createElement('section');
      shell.id = 'cash-dashboard-shell';
      shell.className = 'cash-dashboard-shell';
      app.insertBefore(shell, app.firstChild);
    }

    if (shift.parentElement !== shell) shell.appendChild(shift);
    if (result.parentElement !== shell) shell.appendChild(result);

    const resultHead = result.querySelector('.panel-head');
    if (resultHead) resultHead.style.display = 'none';

    let payments = document.getElementById('cash-payments-summary');
    if (!payments) {
      payments = document.createElement('div');
      payments.id = 'cash-payments-summary';
      payments.className = 'cash-payments-summary';
      payments.innerHTML = `
        <div class="cash-section-heading"><div><span>ОПЛАТЫ</span><strong>Закрытые заказы по типам оплаты</strong></div><em id="cash-payment-total">—</em></div>
        <div class="cash-payment-grid" id="cash-payment-grid"><div class="cash-payment-empty">Загружаем данные оплат…</div></div>`;
      result.insertBefore(payments, resultSummary);
    }

    let ordersHeading = document.getElementById('cash-orders-heading');
    if (!ordersHeading) {
      ordersHeading = document.createElement('div');
      ordersHeading.id = 'cash-orders-heading';
      ordersHeading.className = 'cash-section-heading cash-orders-heading';
      ordersHeading.innerHTML = `<div><span>ЗАКАЗЫ</span><strong>Все заказы кассы</strong></div><em id="cash-orders-live">● LIVE</em>`;
      result.insertBefore(ordersHeading, resultSummary);
    }

    const style = document.createElement('style');
    style.id = 'cash-dashboard-ui-style';
    style.textContent = `
      .app-content{max-width:1400px!important;padding-top:20px!important}
      #cash-dashboard-shell{width:100%;border:1px solid #233142;border-radius:22px;background:linear-gradient(180deg,#0f1721 0%,#0b121a 100%);box-shadow:0 22px 70px rgba(0,0,0,.22);overflow:hidden}
      #cash-dashboard-shell>.panel{margin:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
      #cash-dashboard-shell>.shift-summary-panel{padding:22px 24px 20px!important;border-bottom:1px solid #233142!important}
      #cash-dashboard-shell>.result-panel{padding:22px 24px 26px!important}
      #cash-dashboard-shell .panel-head{border:0!important;padding:0!important;margin:0 0 14px!important}
      #cash-dashboard-shell .panel-title{font-size:16px!important}
      #cash-dashboard-shell .panel-muted{font-size:10px!important}
      .shift-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important}
      .shift-summary-card{min-height:108px!important;border-radius:14px!important;padding:17px 18px!important;background:#121c27!important}
      .shift-summary-card strong{font-size:28px!important;line-height:1.1!important;margin-top:9px!important}
      .shift-summary-card small{font-size:9px!important}
      .cash-section-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:0 0 12px;padding-top:2px}
      .cash-section-heading span{display:block;color:#718294;font-size:8px;font-weight:900;letter-spacing:.13em;margin-bottom:4px}
      .cash-section-heading strong{display:block;font-size:15px;color:#f4f7fa}
      .cash-section-heading em{font-style:normal;color:#42d392;font-size:9px;font-weight:800}
      .cash-payments-summary{margin:0 0 22px;padding:17px 18px;border:1px solid #233142;border-radius:14px;background:#101923}
      .cash-payment-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .cash-payment-card{border:1px solid #263646;border-radius:11px;background:#121c27;padding:12px 13px;min-width:0}
      .cash-payment-card .name{font-size:9px;color:#91a0af;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cash-payment-card .amount{font-size:18px;color:#f4f7fa;font-weight:850;margin-top:5px}
      .cash-payment-card .meta{font-size:9px;color:#667788;margin-top:4px}
      .cash-payment-bar{height:5px;border-radius:99px;background:#202c39;overflow:hidden;margin-top:9px}.cash-payment-bar i{display:block;height:100%;border-radius:99px;background:#42d392}
      .cash-payment-empty{font-size:10px;color:#718294;padding:7px 0}
      .cash-orders-heading{padding:0 2px;margin-bottom:9px}
      #result-summary{margin:0!important;padding:0!important;background:transparent!important;border:0!important}
      #result-summary .orders-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px!important;margin:0 0 14px!important}
      #result-summary .order-stat{min-height:68px!important;border-radius:11px!important;padding:11px 13px!important;background:#121c27!important}
      #result-summary .order-stat strong{font-size:20px!important}
      #result-summary .orders-toolbar{padding:0 2px!important;margin-bottom:7px!important}
      #result-summary .orders-table-wrap{border:1px solid #233142!important;border-radius:14px!important;background:#0f1822!important;padding:6px!important}
      #result-summary .orders-table{width:100%!important;table-layout:auto!important;border-spacing:0!important}
      #result-summary .orders-table thead th{padding:10px 11px!important;background:#111b26!important;border-bottom:1px solid #263646!important;font-size:8px!important}
      #result-summary .orders-table tbody tr{height:47px!important}
      #result-summary .orders-table tbody td{padding:8px 11px!important;background:#0f1822!important;border-top:0!important;border-bottom:1px solid #1d2a38!important;font-size:10px!important}
      #result-summary .orders-table tbody tr:hover td{background:#13221f!important}
      #result-summary .orders-table td:nth-child(4),#result-summary .orders-table td:nth-child(6),#result-summary .orders-table td:nth-child(9),#result-summary .orders-table th:nth-child(4),#result-summary .orders-table th:nth-child(6),#result-summary .orders-table th:nth-child(9){display:none!important}
      #result-summary .orders-table td:first-child{border-left:0!important;border-radius:0!important}
      #result-summary .orders-table td:last-child{border-right:0!important;border-radius:0!important}
      #result-summary .order-open-link{font-size:8px!important;margin-top:3px!important}
      #result-summary .order-state{font-size:8px!important;padding:4px 7px!important}
      #result-summary .orders-pay strong{font-size:9px!important}
      .order-modal{z-index:10000!important}
      @media(max-width:1000px){.cash-payment-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.shift-summary-grid{grid-template-columns:1fr!important}.app-content{padding-left:12px!important;padding-right:12px!important}}
      @media(max-width:650px){.cash-payment-grid{grid-template-columns:1fr!important}#result-summary .orders-stats{grid-template-columns:1fr 1fr!important}#result-summary .orders-table{min-width:720px!important}}
    `;
    document.head.appendChild(style);

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
      for (const k of ['name','title','value','number','code','id']) { if (value[k] != null && value[k] !== '') { const v=scalar(value[k]); if(v!=null&&v!=='') return v; } }
      return null;
    };
    const deep = (obj,names,d=0) => {
      if(obj==null||typeof obj!=='object'||d>12) return null;
      const wanted=names.map(x=>x.toLowerCase());
      if(Array.isArray(obj)){for(const x of obj){const v=deep(x,names,d+1);if(v!=null&&v!=='')return v;}return null;}
      for(const [k,v] of Object.entries(obj)) if(wanted.includes(k.toLowerCase())&&v!=null&&v!=='') return v;
      for(const v of Object.values(obj)){const x=deep(v,names,d+1);if(x!=null&&x!=='')return x;}
      return null;
    };
    const state = row => {
      const s=String(scalar(deep(row,['orderStatus','status','state','orderState','statusName']))??'').toLowerCase();
      if(/closed|close|completed|complete|paid|закрыт|оплачен|заверш/.test(s))return 'closed';
      if(/open|opened|active|new|bill|открыт|актив|новый|пречек/.test(s))return 'open';
      const c=deep(row,['isClosed','closed','isClosedOrder']);
      if(c===true||String(c).toLowerCase()==='true')return 'closed';
      if(c===false||String(c).toLowerCase()==='false')return 'open';
      if(deep(row,['closeTime','closedAt','closingTime','closeDate']))return 'closed';
      return 'unknown';
    };
    const paymentName = p => {
      const direct=scalar(deep(p,['paymentTypeName','paymentType','paymentMethod','paymentName','payTypeName','payType']));
      if(direct)return String(direct);
      const t=String(scalar(p?.type??p?.Type)??'').toLowerCase();
      if(/cash|налич/.test(t))return 'Наличные';
      if(/card|карта|bank|банков|terminal|терминал/.test(t))return 'Карта';
      return null;
    };
    const findRows = value => {
      const out=[];
      const walk=(v,d=0)=>{
        if(v==null||d>12||typeof v!=='object')return;
        if(Array.isArray(v)){for(const x of v)walk(x,d+1);return;}
        if(deep(v,['orderNum','orderNumber'])!=null){out.push(v);return;}
        for(const x of Object.values(v))walk(x,d+1);
      };
      walk(value); return out;
    };

    function updatePayments(){
      const grid=document.getElementById('cash-payment-grid'); const totalEl=document.getElementById('cash-payment-total');
      if(!grid)return;
      let payload={}; try{payload=JSON.parse(document.getElementById('result-output')?.textContent||'{}');}catch(_){return;}
      let data=payload?.data; if(typeof data==='string'){try{data=JSON.parse(data);}catch(_) {}}
      const rows=findRows(data); const map=new Map(); let total=0;
      for(const row of rows){
        if(state(row)!=='closed')continue;
        const amount=parseMoney(scalar(deep(row,['orderExpectedRevenue','revenue','resultSum','orderSum','sum','total','amount'])));
        if(!Number.isFinite(amount))continue;
        let ps=deep(row,['Payments','payments','payment']); if(!Array.isArray(ps))ps=[row];
        let names=[]; for(const p of ps){const n=paymentName(p);if(n&&!names.includes(n))names.push(n);}
        if(!names.length)names=['Не определено'];
        const share=amount/names.length;
        names.forEach(n=>map.set(n,(map.get(n)||0)+share)); total+=amount;
      }
      totalEl.textContent=Number.isFinite(total)?`${total.toLocaleString('ru-RU',{maximumFractionDigits:2})} AZN`: '—';
      if(!map.size){grid.innerHTML='<div class="cash-payment-empty">Типы оплаты пока не определены в данных кассы.</div>';return;}
      const list=[...map.entries()].sort((a,b)=>b[1]-a[1]); const max=Math.max(...list.map(x=>x[1]),1);
      grid.innerHTML=list.slice(0,6).map(([name,amount])=>{const pct=total?amount/total*100:0;return `<div class="cash-payment-card"><div class="name">${String(name).replaceAll('<','&lt;')}</div><div class="amount">${amount.toLocaleString('ru-RU',{maximumFractionDigits:2})}</div><div class="meta">AZN · ${pct.toFixed(0)}% от закрытых</div><div class="cash-payment-bar"><i style="width:${Math.max(2,amount/max*100)}%"></i></div></div>`}).join('');
    }

    const output=document.getElementById('result-output');
    if(output){new MutationObserver(updatePayments).observe(output,{childList:true,characterData:true,subtree:true});}
    setInterval(updatePayments,1500); updatePayments();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();