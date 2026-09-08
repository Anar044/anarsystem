(() => {
  const resultSummary = document.getElementById("result-summary");
  const resultOutput = document.getElementById("result-output");
  const actionSelect = document.getElementById("action-select");
  const sendButton = document.getElementById("send-request");
  const pluginSelect = document.getElementById("plugin-select");
  if (!resultSummary || !resultOutput || !actionSelect) return;

  const style = document.createElement("style");
  style.textContent = `
    /* CASH DASHBOARD: one compact operational window */
    .connected-panel,.request-panel{display:none!important}
    .result-panel{margin-top:0!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}
    .result-panel>.panel-head,.result-panel>.cash-overview-grid,.result-panel>.raw-details{display:none!important}
    .shift-summary-panel{margin-top:0!important;border-radius:18px!important;background:linear-gradient(145deg,#101a23,#0d141c)!important}
    .shift-summary-panel .panel-head{padding-bottom:12px!important}
    .shift-summary-panel .panel-title{font-size:16px!important}
    .shift-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important}
    .shift-summary-card{min-height:112px!important;padding:17px 18px!important;border-radius:15px!important}
    .shift-summary-card span{font-size:9px!important;text-transform:uppercase!important;letter-spacing:.08em!important}
    .shift-summary-card strong{font-size:27px!important;margin-top:8px!important}
    .shift-summary-card small{font-size:10px!important;margin-top:5px!important}
    .cash-control-grid{display:grid;grid-template-columns:minmax(260px,.34fr) minmax(0,1fr);gap:14px;margin-top:14px}
    .cash-payments,.cash-orders-box{border:1px solid var(--line,#24303b);border-radius:16px;background:#101923;overflow:hidden}
    .cash-box-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#24303b)}
    .cash-box-title{font-size:12px;font-weight:850}.cash-box-sub{font-size:9px;color:var(--muted);margin-top:3px}
    .cash-pay-list{padding:15px 16px;display:grid;gap:13px}.cash-pay-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}.cash-pay-name{font-size:11px;font-weight:750}.cash-pay-value{font-size:11px;font-weight:850}.cash-pay-track{height:7px;border-radius:99px;background:#202b36;overflow:hidden;margin-top:7px}.cash-pay-fill{height:100%;border-radius:99px;background:var(--pc-green,#42d392)}.cash-pay-meta{font-size:9px;color:var(--muted);margin-top:4px}
    .cash-orders-box .orders-dashboard{padding:0!important}.cash-orders-box .orders-stats{display:flex!important;gap:8px!important;padding:12px 14px!important;margin:0!important;border-bottom:1px solid var(--line,#24303b);overflow:auto}.cash-orders-box .order-stat{min-width:105px!important;min-height:58px!important;padding:9px 11px!important;border-radius:10px!important}.cash-orders-box .order-stat span{font-size:8px!important}.cash-orders-box .order-stat strong{font-size:18px!important}
    .cash-orders-box .orders-toolbar{padding:11px 14px!important;margin:0!important}.cash-orders-box .orders-table-wrap{padding:0 10px 10px!important}.cash-orders-box .orders-table{width:100%!important;table-layout:auto!important}.cash-orders-box .orders-table thead th:nth-child(4),.cash-orders-box .orders-table thead th:nth-child(6),.cash-orders-box .orders-table thead th:nth-child(9),.cash-orders-box .orders-table tbody td:nth-child(4),.cash-orders-box .orders-table tbody td:nth-child(6),.cash-orders-box .orders-table tbody td:nth-child(9){display:none!important}
    .cash-orders-box .orders-table thead th{padding:8px 9px!important}.cash-orders-box .orders-table tbody tr{height:50px!important}.cash-orders-box .orders-table tbody td{padding:8px 9px!important;font-size:10px!important}.cash-orders-box .orders-table td:nth-child(1){width:72px}.cash-orders-box .orders-table td:nth-child(7){font-weight:850!important;white-space:nowrap}.cash-orders-box .orders-table td:nth-child(8),.cash-orders-box .orders-table td:nth-child(10){font-size:9px!important}.cash-orders-box .order-action-button{display:none!important}.cash-orders-box .order-open-link{font-size:8px!important}
    .cash-empty-state{padding:28px 16px;text-align:center;color:var(--muted);font-size:11px}
    @media(max-width:1050px){.cash-control-grid{grid-template-columns:1fr}.cash-pay-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:700px){.shift-summary-grid{grid-template-columns:1fr!important}.cash-pay-list{grid-template-columns:1fr}.cash-orders-box .orders-table{min-width:760px!important}}
  `;
  document.head.appendChild(style);

  const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const num = v => { const n=Number(String(v??"").replace(/\s/g,"").replace(/[^0-9,.-]/g,"").replace(",",".")); return Number.isFinite(n)?n:0; };
  const money = v => `${num(v).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})} AZN`;
  const lower = v => String(v??"").toLowerCase();

  function scalar(v){
    if(v==null||v==="") return null;
    if(typeof v!=="object") return v;
    if(Array.isArray(v)){for(const x of v){const r=scalar(x);if(r!=null&&r!=="")return r;}return null;}
    for(const k of ["name","title","value","number","code","id"]){const r=scalar(v[k]);if(r!=null&&r!=="")return r;}
    return null;
  }
  function deep(v,names,d=0){
    if(v==null||typeof v!=="object"||d>12)return null;
    const wanted=names.map(x=>lower(x));
    if(Array.isArray(v)){for(const x of v){const r=deep(x,names,d+1);if(r!=null&&r!=="")return r;}return null;}
    for(const [k,x] of Object.entries(v)) if(wanted.includes(lower(k))&&x!=null&&x!=="") return x;
    for(const x of Object.values(v)){const r=deep(x,names,d+1);if(r!=null&&r!=="")return r;}
    return null;
  }
  function collect(v,out=[],d=0){
    if(v==null||d>12||typeof v!=="object")return out;
    if(Array.isArray(v)){for(const x of v)collect(x,out,d+1);return out;}
    out.push(v);for(const x of Object.values(v))collect(x,out,d+1);return out;
  }
  function getRows(payload){
    const candidates=[];
    collect(payload,candidates);
    const arrays=[];
    function scan(v,d=0){if(v==null||d>10||typeof v!=="object")return;if(Array.isArray(v)){if(v.length&&v.some(x=>x&&typeof x==="object"))arrays.push(v);v.forEach(x=>scan(x,d+1));return;}Object.values(v).forEach(x=>scan(x,d+1));}
    scan(payload);
    arrays.sort((a,b)=>b.length-a.length);
    return arrays[0]||[];
  }

  function paymentEntries(payload){
    const result=new Map();
    const add=(name,value)=>{name=String(name||"Другой способ оплаты").trim();const amount=num(value);if(!result.has(name))result.set(name,0);if(amount>0)result.set(name,result.get(name)+amount);};
    for(const obj of collect(payload)){
      for(const key of ["payments","Payments","paymentDetails","PaymentDetails"]){
        const arr=obj[key];
        if(!Array.isArray(arr))continue;
        for(const p of arr){if(!p||typeof p!=="object")continue;const name=scalar(p.name??p.Name??p.type??p.Type??p.paymentType??p.PaymentType??p.paymentMethod??p.PaymentMethod);const value=scalar(p.sum??p.Sum??p.amount??p.Amount??p.value??p.Value??p.resultSum??p.ResultSum);if(name&&num(value)>0)add(name,value);}
      }
    }
    return [...result.entries()].sort((a,b)=>b[1]-a[1]);
  }

  function buildPayments(payload){
    const entries=paymentEntries(payload);
    const box=document.createElement("section");box.className="cash-payments";
    if(!entries.length){box.innerHTML='<div class="cash-box-head"><div><div class="cash-box-title">Оплаты</div><div class="cash-box-sub">По закрытым заказам</div></div></div><div class="cash-empty-state">Касса не передала разбивку суммы по типам оплаты.</div>';return box;}
    const total=entries.reduce((s,x)=>s+x[1],0), max=entries[0]?.[1]||1;
    box.innerHTML='<div class="cash-box-head"><div><div class="cash-box-title">Типы оплаты</div><div class="cash-box-sub">Закрытые заказы · текущие данные</div></div><strong>'+esc(money(total))+'</strong></div><div class="cash-pay-list">'+entries.map(([name,value])=>{const pct=total?value/total*100:0;return `<div><div class="cash-pay-row"><span class="cash-pay-name">${esc(name)}</span><span class="cash-pay-value">${esc(money(value))}</span></div><div class="cash-pay-track"><div class="cash-pay-fill" style="width:${Math.min(100,value/max*100)}%"></div></div><div class="cash-pay-meta">${pct.toFixed(1)}% от оплат</div></div>`}).join("")+'</div>';
    return box;
  }

  function enhance(){
    const dashboard=resultSummary.querySelector(".orders-dashboard");
    if(!dashboard)return;
    let grid=resultSummary.querySelector(".cash-control-grid");
    if(!grid){
      grid=document.createElement("div");grid.className="cash-control-grid";
      const ordersBox=document.createElement("section");ordersBox.className="cash-orders-box";
      ordersBox.appendChild(dashboard);
      grid.appendChild(document.createElement("div"));
      grid.appendChild(ordersBox);
      resultSummary.innerHTML="";
      resultSummary.appendChild(grid);
      const raw=resultOutput.textContent||"{}";let payload={};try{const j=JSON.parse(raw);payload=typeof j.data==="string"?JSON.parse(j.data):j.data||j;}catch(_){ }
      grid.firstElementChild.replaceWith(buildPayments(payload));
    } else {
      const ordersBox=grid.querySelector(".cash-orders-box");
      if(ordersBox&&!ordersBox.contains(dashboard))ordersBox.appendChild(dashboard);
    }
  }

  function requestOrders(){
    if(pluginSelect?.value && !pluginSelect.disabled && actionSelect.value!=="get_orders"){
      actionSelect.value="get_orders";
      actionSelect.dispatchEvent(new Event("change",{bubbles:true}));
    }
    if(pluginSelect?.value && !pluginSelect.disabled && sendButton && !sendButton.disabled) setTimeout(()=>sendButton.click(),250);
  }

  const observer=new MutationObserver(()=>{enhance();});
  observer.observe(resultSummary,{childList:true,subtree:true});
  const outputObserver=new MutationObserver(()=>{enhance();});
  outputObserver.observe(resultOutput,{childList:true,characterData:true,subtree:true});

  setTimeout(requestOrders,700);
  setInterval(()=>{if(actionSelect.value!=="get_orders")requestOrders();enhance();},10000);
})();