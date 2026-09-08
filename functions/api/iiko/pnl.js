// ============================================================
// ANAR SYSTEM — P&L FROM IIKO OLAP
// Revenue: SALES OLAP by dish category
// COGS + financial articles: TRANSACTIONS OLAP
// Cash shifts are intentionally NOT used here.
// ============================================================

function corsHeaders(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders()}})}
function clean(v){return String(v??'').trim()}
async function sha1(s){const h=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(s));return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function auth(b){const ip=clean(b.ip),port=clean(b.port),login=clean(b.login),password=String(b.password??'');if(!ip||!port||!login||!password)throw Error('Заполните IP, порт, логин и пароль iiko');const u=`http://${ip}:${port}`,p=await sha1(password);const r=await fetch(`${u}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${p}`);const t=(await r.text()).trim();if(!r.ok||!t)throw Error(`Ошибка авторизации iiko: HTTP ${r.status}`);return{u,t}}
async function get(u,o={}){const r=await fetch(u,{...o,headers:{Accept:'application/json',...(o.headers||{})},cache:'no-store'});const t=(await r.text()).trim();let p=null;try{p=JSON.parse(t||'{}')}catch{}return{r,t,p}}
function normalizeFields(raw){const out=[];const add=(name,meta={})=>{name=clean(name);if(!name||out.some(x=>x.name.toLowerCase()===name.toLowerCase()))return;out.push({name,title:clean(meta.title||meta.caption||meta.label||meta.displayName||meta.name||name),type:clean(meta.type||meta.dataType||meta.kind||'unknown')})};if(Array.isArray(raw))raw.forEach(x=>typeof x==='string'?add(x):x&&add(x.technicalName||x.field||x.key||x.code||x.id||x.name,x));else if(raw&&typeof raw==='object'){for(const k of['fields','columns','dimensions','measures'])if(Array.isArray(raw[k]))raw[k].forEach(x=>typeof x==='string'?add(x):x&&add(x.technicalName||x.field||x.key||x.code||x.id||x.name,x));for(const[k,v]of Object.entries(raw))if(!['fields','columns','dimensions','measures','data','items'].includes(k)&&v&&typeof v==='object'&&!Array.isArray(v))add(k,v)}return out}
async function cols(u,t,type){const x=await get(`${u}/resto/api/v2/reports/olap/columns?key=${encodeURIComponent(t)}&reportType=${encodeURIComponent(type)}`);if(!x.r.ok||!x.p)throw Error(`OLAP ${type}: HTTP ${x.r.status}`);return normalizeFields(x.p)}
function norm(s){return clean(s).toLowerCase().replace(/[\s._()\/-]+/g,'')}
function findField(fs,candidates){for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name)===q||norm(f.title)===q);if(x)return x.name}for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name).includes(q)||norm(f.title).includes(q));if(x)return x.name}return null}
function endExclusive(to){const d=new Date(`${to}T00:00:00`);d.setDate(d.getDate()+1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dateFilter(from,to){return{filterType:'DateRange',periodType:'CUSTOM',from,to:endExclusive(to)}}
async function olap(u,t,type,q){const req={reportType:type,buildSummary:true,groupByRowFields:q.rows||[],groupByColFields:q.cols||[],aggregateFields:q.measures||[],filters:{...(q.filters||{})}};if(q.from&&q.to&&q.dateField)req.filters[q.dateField]=dateFilter(q.from,q.to);const x=await get(`${u}/resto/api/v2/reports/olap?key=${encodeURIComponent(t)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});return{request:req,ok:x.r.ok,report:x.p,error:x.r.ok?null:`HTTP ${x.r.status}: ${x.t.slice(0,2000)}`}}
function number(v){if(typeof v==='number')return Number.isFinite(v)?v:0;if(v===null||v===undefined||v==='')return 0;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0}
function value(row,key){return number(row?.[key]??row?.[String(key).toLowerCase()]??0)}
function allRows(report){return Array.isArray(report?.data)?report.data:[]}
function rowText(row,field){return clean(row?.[field]??row?.[String(field).toLowerCase()]??'')}
function sumField(report,field){return allRows(report).reduce((a,r)=>a+value(r,field),0)}
// iiko SALES fields used here:
// DishSumInt   = amount before discounts/increases.
// DiscountSum  = actual discount amount.
// IncreaseSum  = actual surcharge amount.
// Therefore net revenue = base - discount + surcharge.
function netRevenue(r,base,discount,surcharge){return value(r,base)-(discount?value(r,discount):0)+(surcharge?value(r,surcharge):0)}
function autoCategory(r){const t=r.accountType.toLowerCase(),n=r.name.toLowerCase();if(/asset|актив|активы|активлар/.test(t)||/liabil|обязат|borc/.test(t)||/equity|капитал|капиталı/.test(t))return'EXCLUDED';if(/income|доход|gəlir/.test(t))return'REVENUE';if(/expense|расход|xərc/.test(t)||/проч.*расход|other expense|digər xərc/.test(n))return'OPEX';if(/проч.*доход|other income|digər gəlir/.test(n))return'OTHER_INCOME';return'UNCLASSIFIED'}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}

export async function onRequestPost(c){
  try{
    const b=await c.request.json();const from=clean(b.from).slice(0,10),to=clean(b.to||b.from).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({success:false,message:'Укажите корректный период'},400);
    const{u,t}=await auth(b);const salesFields=await cols(u,t,'SALES');const transactionFields=await cols(u,t,'TRANSACTIONS');

    // IMPORTANT: DiscountSum is the actual discount amount.
    // DishDiscountSumInt is a different iiko OLAP measure and must not be used
    // as the displayed "Сумма скидки" when DiscountSum is available.
    const revenueBase=findField(salesFields,['DishSumInt','Сумма без учета скидок и надбавок','Сумма без скидки','Сумма без скидок','Торговая выручка без учета скидок']);
    const discount=findField(salesFields,['DiscountSum','Сумма скидки','Скидка','Discount','DishDiscountSumInt']);
    const surcharge=findField(salesFields,['IncreaseSum','Сумма надбавки','Надбавка','Increase','Surcharge','DishIncreaseSumInt']);
    const category=findField(salesFields,['DishCategory','DishCategory.Name','DishCategoryName','Category','Category.Name','CategoryName','Категория блюда']);
    const salesDate=findField(salesFields,['OpenDate.Typed','OpenDate','Учетный день','Дата']);
    if(!revenueBase)throw Error('В OLAP SALES не найдено поле «Сумма без скидки».');
    if(!discount)throw Error('В OLAP SALES не найдено поле «Сумма скидки» (DiscountSum).');
    if(!category)throw Error('В OLAP SALES не найдено поле «Категория блюда». Откройте «Диагностика источников» — нам нужно увидеть точное название поля категории.');

    const categoryQuery=await olap(u,t,'SALES',{rows:[category],measures:[revenueBase,discount,...[surcharge].filter(Boolean)],from,to,dateField:salesDate||'OpenDate.Typed'});
    if(!categoryQuery.ok)throw Error(`OLAP SALES по категориям: ${categoryQuery.error}`);

    const revenueBaseValue=sumField(categoryQuery.report,revenueBase);
    const discountValue=sumField(categoryQuery.report,discount);
    const surchargeValue=surcharge?sumField(categoryQuery.report,surcharge):0;

    const categoryRows=allRows(categoryQuery.report).map(r=>({name:rowText(r,category)||'Без категории',value:netRevenue(r,revenueBase,discount,surcharge),base:value(r,revenueBase),discount:value(r,discount),surcharge:surcharge?value(r,surcharge):0})).filter(x=>x.name&&Math.abs(x.value)>0.000001);
    const revenue=revenueBaseValue-discountValue+surchargeValue;
    if(!categoryRows.length)throw Error('iiko OLAP SALES не вернул строки по категориям блюд за выбранный период. Проверьте период и наличие продаж.');

    const article=findField(transactionFields,['Account.Name','AccountName','Счет','Счёт','FinancialArticle','Article','Account']);
    const amount=findField(transactionFields,['Sum','Сумма','Amount','Value','TransactionSum','MoneySum']);
    const accountId=findField(transactionFields,['Account.Id','Account.ID','AccountId','AccountUUID','Account.Guid','Account.Code']);
    const accountType=findField(transactionFields,['Account.Type','AccountType','Account.TypeName','Account.Kind','Тип счета','Тип счёта','Type']);
    const counterAccount=findField(transactionFields,['CounterAccount.Name','CounterAccountName','Корр.Счет/Склад','Корр. Счет/Склад','CounterAccount']);
    const trDate=findField(transactionFields,['DateTime.DateTyped','DateTime.Typed','DateTime.Date','Date.Typed','Date','TransactionDate','OperationDate','OpenDate.Typed','Учетный день']);
    if(!article||!amount)throw Error('В OLAP TRANSACTIONS не найдены поля «Счет» и/или «Сумма».');
    const postingRows=[article];for(const f of[accountId,accountType,counterAccount])if(f&&!postingRows.includes(f))postingRows.push(f);
    const postingQuery=await olap(u,t,'TRANSACTIONS',{rows:postingRows,measures:[amount],from,to,dateField:trDate||'DateTime.DateTyped'});if(!postingQuery.ok)throw Error(`OLAP TRANSACTIONS: ${postingQuery.error}`);
    const rawPostings=allRows(postingQuery.report);const postings=rawPostings.map(r=>({name:rowText(r,article)||'Без статьи',value:value(r,amount),accountId:accountId?rowText(r,accountId):'',accountType:accountType?rowText(r,accountType):'',counterAccount:counterAccount?rowText(r,counterAccount):''})).filter(x=>x.name);
    const cogs=Math.abs(rawPostings.filter(r=>rowText(r,article).toLowerCase()==='расход продуктов').reduce((a,r)=>a+value(r,amount),0));
    const financial=postings.filter(x=>x.name.toLowerCase()!=='расход продуктов').map(x=>({...x,pnlCategory:autoCategory(x)}));
    const opex=financial.filter(x=>x.pnlCategory==='OPEX').reduce((a,x)=>a+Math.abs(x.value),0);const otherIncome=financial.filter(x=>x.pnlCategory==='OTHER_INCOME').reduce((a,x)=>a+Math.abs(x.value),0);const otherExpense=financial.filter(x=>x.pnlCategory==='OTHER_EXPENSE').reduce((a,x)=>a+Math.abs(x.value),0);
    const grossProfit=revenue-cogs,operatingProfit=grossProfit-opex,netProfit=operatingProfit+otherIncome-otherExpense;

    const revenueRows=[{name:'Выручка',value:revenue,kind:'section',level:true,open:true},{name:'Сумма без скидки',value:revenueBaseValue,kind:'sub'},{name:'Сумма скидки',value:discountValue,kind:'sub'},{name:'Сумма надбавки',value:surchargeValue,kind:'sub'},{name:'Итого выручка',value:revenue,kind:'total'}];
    const final=[...revenueRows,{name:'Себестоимость',value:-cogs,kind:'section',level:true,open:true},{name:'Расход продуктов',value:-cogs,kind:'sub'},{name:'Валовая прибыль',value:grossProfit,kind:'total'},{name:'Операционные расходы',value:-opex,kind:'section',level:true,open:true},...financial.filter(x=>x.pnlCategory==='OPEX').map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub'})),{name:'Операционная прибыль',value:operatingProfit,kind:'total'},{name:'Прочие доходы',value:otherIncome,kind:'section',level:true,open:true},...financial.filter(x=>x.pnlCategory==='OTHER_INCOME').map(x=>({name:x.name,value:Math.abs(x.value),kind:'sub'})),{name:'Прочие расходы',value:-otherExpense,kind:'section',level:true,open:true},...financial.filter(x=>x.pnlCategory==='OTHER_EXPENSE').map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub'})),{name:'ИТОГО ЧИСТАЯ ПРИБЫЛЬ',value:netProfit,kind:'total profit'}];

    return json({success:true,revenue,revenueBase:revenueBaseValue,discount:discountValue,surcharge:surchargeValue,revenueCategories:categoryRows.sort((a,b)=>b.value-a.value).map(x=>({name:x.name,value:x.value,share:revenue?x.value/revenue*100:0,base:x.base,discount:x.discount,surcharge:x.surcharge})),cogs,opex,otherIncome,otherExpense,grossProfit,operatingProfit,netProfit,rows:final,accounts:postings.map(x=>({...x,pnlCategory:x.name.toLowerCase()==='расход продуктов'?'COGS':autoCategory(x)})),salesFields,transactionFields,sourceNote:'iiko Server · OLAP SALES по категориям блюд + OLAP TRANSACTIONS · без кассовых смен',debug:{salesRequest:categoryQuery.request,salesRows:categoryRows.length,salesReport:categoryQuery.report,transactionRows:rawPostings.length,selectedSalesFields:{revenueBase,discount,surcharge,category,salesDate}}});
  }catch(e){console.error('IIKO P&L ERROR',e);return json({success:false,message:e.message||'Ошибка P&L'},502)}
}
