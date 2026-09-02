from pathlib import Path
import re

p=Path('plugin-control.html')
s=p.read_text()
pattern=r'  <section class="card panel live-panel">.*?  </section>\n\n  <section class="card panel request-panel">'
replacement='''  <section class="card panel shift-summary-panel">
    <div class="panel-head">
      <div>
        <div class="section-kicker">SHIFT SUMMARY</div>
        <div class="panel-title">Выручка текущей смены</div>
        <div class="panel-muted">Закрытые и открытые заказы с подключённой кассы.</div>
      </div>
      <div class="shift-live-status"><span class="pulse-dot"></span><span id="shift-summary-status">Обновляется автоматически</span></div>
    </div>
    <div class="shift-summary-grid">
      <div class="shift-summary-card closed"><span>Закрытые заказы</span><strong id="shift-closed-sum">—</strong><small>сумма оплаченных/закрытых заказов</small></div>
      <div class="shift-summary-card open"><span>Открытые заказы</span><strong id="shift-open-sum">—</strong><small>текущая сумма открытых заказов</small></div>
      <div class="shift-summary-card expected"><span>Ожидаемая выручка</span><strong id="shift-expected-sum">—</strong><small>закрытые + открытые заказы</small></div>
    </div>
  </section>

  <section class="card panel request-panel">'''
s,n=re.subn(pattern,replacement,s,flags=re.S)
assert n==1, n
script='''\n<script>\n(() => {\n  const closedEl=document.getElementById("shift-closed-sum"),openEl=document.getElementById("shift-open-sum"),expectedEl=document.getElementById("shift-expected-sum"),statusEl=document.getElementById("shift-summary-status");\n  if(!closedEl||!openEl||!expectedEl)return;\n  const money=v=>Number(v||0).toLocaleString("ru-RU",{maximumFractionDigits:2});\n  const text=v=>String(v??"").toLowerCase();\n  const first=v=>{if(v==null||v==="")return null;if(typeof v!=="object")return v;if(Array.isArray(v)){for(const x of v){const y=first(x);if(y!=null&&y!=="")return y;}return null;}for(const k of ["name","title","value","number","code","id"]){const y=first(v[k]);if(y!=null&&y!=="")return y;}return null;};\n  const deep=(v,names,d=0)=>{if(v==null||typeof v!=="object"||d>12)return null;const wanted=names.map(x=>String(x).toLowerCase());if(Array.isArray(v)){for(const x of v){const y=deep(x,names,d+1);if(y!=null&&y!=="")return y;}return null;}for(const [k,x] of Object.entries(v))if(wanted.includes(k.toLowerCase())&&x!=null&&x!=="")return x;for(const x of Object.values(v)){const y=deep(x,names,d+1);if(y!=null&&y!=="")return y;}return null;};\n  const num=v=>{if(typeof v==="number"&&Number.isFinite(v))return v;if(typeof v!=="string")return NaN;const x=Number(v.replace(/[^0-9,.-]/g,"").replace(",","."));return Number.isFinite(x)?x:NaN;};\n  const rowsOf=(v,d=0)=>{if(v==null||d>10)return null;if(Array.isArray(v)){const r=v.filter(x=>x&&typeof x==="object");return r.length?r:null;}if(typeof v!=="object")return null;for(const k of ["orders","items","rows","data","result","records","report"]){if(v[k]!==undefined){const r=rowsOf(v[k],d+1);if(r?.length)return r;}}for(const x of Object.values(v)){const r=rowsOf(x,d+1);if(r?.length)return r;}return null;};\n  async function update(){try{const sr=await fetch("/api/plugin/data",{cache:"no-store"}),sj=await sr.json(),plugin=sj?.plugins?.[0];if(!plugin?.pluginId){closedEl.textContent=openEl.textContent=expectedEl.textContent="—";statusEl.textContent="Касса не подключена";return;}const r=await fetch("/api/plugin/request",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({action:"get_orders",pluginId:plugin.pluginId,params:{}})}),j=await r.json();if(!r.ok||!j.success)throw new Error(j.error||`HTTP ${r.status}`);const rows=rowsOf(j.data)||[];let closed=0,open=0;for(const row of rows){const value=num(first(deep(row,["revenue","resultSum","orderExpectedRevenue","orderSum","sum","total","amount"])));if(!Number.isFinite(value))continue;const status=text(first(deep(row,["orderStatus","status","state","orderState","statusName"]))),close=deep(row,["closeTime","orderCloseTime","closedAt","closingTime"]),isClosed=/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(status)||!!close;if(isClosed)closed+=value;else open+=value;}closedEl.textContent=money(closed);openEl.textContent=money(open);expectedEl.textContent=money(closed+open);statusEl.textContent=`Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;}catch(e){statusEl.textContent="Не удалось обновить";}}\n  update();setInterval(update,10000);\n})();\n</script>\n'''
s=s.replace('</body>',script+'</body>')
p.write_text(s)

c=Path('plugin-control.css')
css=c.read_text()
css += '.shift-summary-panel{margin-top:16px}.shift-live-status{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:var(--pc-green-soft);border:1px solid rgba(32,216,121,.22);font-size:10px;font-weight:850;color:var(--pc-green)}.shift-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.shift-summary-card{padding:18px;border:1px solid var(--line);border-radius:15px;background:var(--surface2);min-width:0}.shift-summary-card span{display:block;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:800}.shift-summary-card strong{display:block;font-size:25px;line-height:1.25;margin-top:7px}.shift-summary-card small{display:block;color:var(--muted);font-size:9px;margin-top:5px}.shift-summary-card.closed strong{color:var(--pc-red,#ff6b6b)}.shift-summary-card.open strong{color:var(--pc-orange,#ffb454)}.shift-summary-card.expected{background:linear-gradient(145deg,var(--surface2),var(--pc-green-soft));border-color:rgba(32,216,121,.22)}.shift-summary-card.expected strong{color:var(--pc-green)}@media(max-width:700px){.shift-summary-grid{grid-template-columns:1fr}.shift-live-status{display:none}}'
c.write_text(css)
