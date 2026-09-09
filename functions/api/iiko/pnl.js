// ============================================================
// ANAR SYSTEM — P&L FROM IIKO
// Revenue: TRANSACTIONS OLAP by Account.Type
// Discounts / surcharges: SALES OLAP
// COGS / OPEX / other blocks: TRANSACTIONS OLAP by Account.Type
// Cash shifts are intentionally NOT used here.
//
// IMPORTANT:
// P&L block membership is determined by Account.Type, NOT Account.Name.
// Account.Id is the stable grouping identifier.
// Account.Name is display-only.
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

// The P&L classifier is based on the account type. Account names are never
// used to decide whether a posting belongs to revenue, COGS or expenses.
function accountTypeRole(type){
  const n=norm(type);
  if(!n)return'UNCLASSIFIED';
  if(n===norm('Доходы')||n==='income'||n==='revenues'||n==='revenue')return'REVENUE';
  if(n.includes(norm('Прямые издержки'))||n.includes(norm('себестоимость'))||n.includes('directcost')||n.includes('costofgoods')||n==='cogs'||n==='cost')return'COGS';
  if(n===norm('Расходы')||n==='expense'||n==='expenses'||n==='opex')return'OPEX';
  if(n.includes(norm('Прочие доходы'))||n.includes('otherincome'))return'OTHER_INCOME';
  if(n.includes(norm('Прочие расходы'))||n.includes('otherexpense')||n.includes('otherexpenses'))return'OTHER_EXPENSE';
  if(n.includes(norm('актив'))||n.includes('asset')||n.includes(norm('обязатель'))||n.includes('liabil')||n.includes(norm('капитал'))||n.includes('equity'))return'EXCLUDED';
  return'UNCLASSIFIED';
}
function groupAccounts(postings,role){
  const m=new Map();
  for(const x of postings){
    if(x.role!==role)continue;
    const key=x.accountId||`row:${x.name}`;
    const old=m.get(key);
    if(old)old.value+=x.value;
    else m.set(key,{accountId:x.accountId||null,name:x.name,accountType:x.accountType,value:x.value,role:x.role});
  }
  return [...m.values()].filter(x=>Math.abs(x.value)>0.000001).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
}
function accountRoleTotal(list){return(list||[]).reduce((a,x)=>a+Number(x.value||0),0)}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}

export async function onRequestPost({request}){
  try{
    const b=await request.json();
    const from=clean(b.from).slice(0,10),to=clean(b.to||b.from).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({success:false,message:'Укажите корректный период'},400);

    const{u,t}=await auth(b);
    const salesFields=await cols(u,t,'SALES');
    const transactionFields=await cols(u,t,'TRANSACTIONS');

    // ------------------------------------------------------------
    // SALES OLAP: only discounts, surcharges and analytics.
    // These are intentionally NOT taken from TRANSACTIONS.
    // ------------------------------------------------------------
    const salesBase=findField(salesFields,['DishSumInt','Сумма без учета скидок и надбавок','Сумма без скидки','Сумма без скидок','Торговая выручка без учета скидок']);
    const discount=findField(salesFields,['DiscountSum','DiscountSumInt','Сумма скидки','Скидка','Discount']);
    const surcharge=findField(salesFields,['IncreaseSum','IncreaseSumInt','Сумма надбавки','Надбавка','Increase','Surcharge','DishIncreaseSumInt']);
    const category=findField(salesFields,['DishCategory','DishCategory.Name','DishCategoryName','Category','Category.Name','CategoryName','Категория блюда']);
    const salesDate=findField(salesFields,['OpenDate.Typed','OpenDate','Учетный день','Дата']);
    if(!salesBase)throw Error('В OLAP SALES не найдено поле для суммы продаж.');
    if(!discount)throw Error('В OLAP SALES не найдено поле «Сумма скидки».');
    if(!category)throw Error('В OLAP SALES не найдено поле «Категория блюда».');

    const categoryQuery=await olap(u,t,'SALES',{rows:[category],measures:[salesBase,discount,...(surcharge?[surcharge]:[])],from,to,dateField:salesDate||'OpenDate.Typed'});
    if(!categoryQuery.ok)throw Error(`OLAP SALES по категориям: ${categoryQuery.error}`);
    const categoryRows=allRows(categoryQuery.report).map(r=>({
      name:rowText(r,category)||'Без категории',
      base:value(r,salesBase),
      discount:value(r,discount),
      surcharge:surcharge?value(r,surcharge):0,
      value:value(r,salesBase)+value(r,discount)-(surcharge?value(r,surcharge):0)
    })).filter(x=>x.name&&Math.abs(x.value)>0.000001);
    const salesDiscount= sumField(categoryQuery.report,discount);
    const salesSurcharge=surcharge?sumField(categoryQuery.report,surcharge):0;
    const categoryBase=sumField(categoryQuery.report,salesBase);
    const categoryRevenue=categoryBase+salesDiscount-salesSurcharge;
    if(!categoryRows.length)throw Error('iiko OLAP SALES не вернул строки по категориям за выбранный период.');

    // ------------------------------------------------------------
    // TRANSACTIONS OLAP: P&L blocks by Account.Type.
    // Account.Id is used as the stable grouping key; Account.Name is display-only.
    // ------------------------------------------------------------
    const article=findField(transactionFields,['Account.Name','AccountName','Счет','Счёт','FinancialArticle','Article','Account']);
    const amount=findField(transactionFields,['Sum','Сумма','Amount','Value','TransactionSum','MoneySum']);
    const accountId=findField(transactionFields,['Account.Id','Account.ID','AccountId','AccountUUID','Account.Guid','Account.Code']);
    const accountType=findField(transactionFields,['Account.Type','AccountType','Account.TypeName','Account.Kind','Тип счета','Тип счёта','Type']);
    const counterAccount=findField(transactionFields,['CounterAccount.Name','CounterAccountName','Корр.Счет/Склад','Корр. Счет/Склад','CounterAccount']);
    const trDate=findField(transactionFields,['DateTime.DateTyped','DateTime.Typed','DateTime.Date','Date.Typed','Date','TransactionDate','OperationDate','OpenDate.Typed','Учетный день']);
    if(!article||!amount)throw Error('В OLAP TRANSACTIONS не найдены поля «Счет» и/или «Сумма».');
    if(!accountType)throw Error('В OLAP TRANSACTIONS не найдено поле «Тип счета».');

    const postingRows=[article,accountType];
    for(const f of[accountId,counterAccount])if(f&&!postingRows.includes(f))postingRows.push(f);
    const postingQuery=await olap(u,t,'TRANSACTIONS',{rows:postingRows,measures:[amount],from,to,dateField:trDate||'DateTime.DateTyped'});
    if(!postingQuery.ok)throw Error(`OLAP TRANSACTIONS: ${postingQuery.error}`);

    const rawPostings=allRows(postingQuery.report);
    const postings=rawPostings.map(r=>{
      const item={
        name:rowText(r,article)||'Без счета',
        value:value(r,amount),
        accountId:accountId?rowText(r,accountId):'',
        accountType:rowText(r,accountType),
        counterAccount:counterAccount?rowText(r,counterAccount):''
      };
      return{...item,role:accountTypeRole(item.accountType)};
    }).filter(x=>x.name);

    const revenueAccounts=groupAccounts(postings,'REVENUE');
    const cogsAccounts=groupAccounts(postings,'COGS');
    const opexAccounts=groupAccounts(postings,'OPEX');
    const otherIncomeAccounts=groupAccounts(postings,'OTHER_INCOME');
    const otherExpenseAccounts=groupAccounts(postings,'OTHER_EXPENSE');

    // IMPORTANT: Trading revenue comes from TRANSACTIONS by account type.
    // SALES is NOT used for this P&L line.
    // Discounts and surcharges come ONLY from SALES OLAP.
    const tradingRevenue=categoryBase;
    const discountValue=salesDiscount;
    const surchargeValue=salesSurcharge;
    const otherTradingRevenue=0;
    const revenue=tradingRevenue+discountValue-surchargeValue;

    const cogs=Math.abs(accountRoleTotal(cogsAccounts));
    const opex=Math.abs(accountRoleTotal(opexAccounts));
    const otherIncome=Math.abs(accountRoleTotal(otherIncomeAccounts));
    const otherExpense=Math.abs(accountRoleTotal(otherExpenseAccounts));
    const grossProfit=revenue-cogs;
    const operatingProfit=grossProfit-opex;
    const netProfit=operatingProfit+otherIncome-otherExpense;

    const revenueRows=[
      {name:'Выручка',value:revenue,kind:'section',level:true,open:true},
      {name:'Торговая выручка',value:tradingRevenue,kind:'sub'},
      {name:'Предоставленные скидки',value:discountValue,kind:'sub'},
      {name:'Сумма надбавки',value:-surchargeValue,kind:'sub'},
      {name:'Торговая выручка, прочие',value:otherTradingRevenue,kind:'sub'},
      {name:'Итого Торговая выручка',value:revenue,kind:'total'},
      {name:'Итого Выручка',value:revenue,kind:'total'}
    ];

    const cogsRows=cogsAccounts.map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub'}));
    const opexRows=opexAccounts.map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub'}));
    const otherIncomeRows=otherIncomeAccounts.map(x=>({name:x.name,value:Math.abs(x.value),kind:'sub'}));
    const otherExpenseRows=otherExpenseAccounts.map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub'}));

    const final=[...revenueRows,
      {name:'Себестоимость',value:-cogs,kind:'section',level:true,open:true},
      ...cogsRows,
      {name:'Валовая прибыль',value:grossProfit,kind:'total profit'},
      {name:'Операционные расходы',value:-opex,kind:'section',level:true,open:true},
      ...opexRows,
      {name:'Операционная прибыль',value:operatingProfit,kind:'total'},
      {name:'Прочие доходы',value:otherIncome,kind:'section',level:true,open:true},
      ...otherIncomeRows,
      {name:'Прочие расходы',value:-otherExpense,kind:'section',level:true,open:true},
      ...otherExpenseRows,
      {name:'ИТОГО ЧИСТАЯ ПРИБЫЛЬ',value:netProfit,kind:'total profit'}
    ];

    return json({
      success:true,
      revenue,
      revenueBase:tradingRevenue,
      discount:discountValue,
      surcharge:surchargeValue,
      revenueAccounts:{
        tradingRevenue,
        transactionRevenueTotal:tradingRevenue,
        otherTradingRevenue,
        totalRevenue:revenue,
        olapDiscount:discountValue,
        olapSurcharge:surchargeValue,
        source:'TRANSACTIONS Account.Type + SALES OLAP discounts/surcharges'
      },
      revenueCategories:categoryRows.sort((a,b)=>b.value-a.value).map(x=>({name:x.name,value:x.value,share:categoryRevenue?x.value/categoryRevenue*100:0,base:x.base,discount:x.discount,surcharge:x.surcharge})),
      categoryRevenue,
      cogs,opex,otherIncome,otherExpense,grossProfit,operatingProfit,netProfit,
      rows:final,
      accounts:postings.map(x=>({...x,pnlCategory:x.role})),
      accountTypeSummary:{REVENUE:revenueAccounts,COGS:cogsAccounts,OPEX:opexAccounts,OTHER_INCOME:otherIncomeAccounts,OTHER_EXPENSE:otherExpenseAccounts},
      salesFields,transactionFields,
      sourceNote:'iiko Server · P&L блоки определяются по Account.Type; Account.Id используется для группировки; названия счетов только отображаются · Торговая выручка: TRANSACTIONS Account.Type · скидки/надбавки: SALES OLAP · без кассовых смен',
      debug:{
        salesRequest:categoryQuery.request,
        salesRows:categoryRows.length,
        salesReport:categoryQuery.report,
        transactionRows:rawPostings.length,
        selectedSalesFields:{salesBase,discount,surcharge,category,salesDate},
        selectedTransactionFields:{article,amount,accountId,accountType,counterAccount,trDate},
        accountTypeSummary:{REVENUE:revenueAccounts.length,COGS:cogsAccounts.length,OPEX:opexAccounts.length,OTHER_INCOME:otherIncomeAccounts.length,OTHER_EXPENSE:otherExpenseAccounts.length,UNCLASSIFIED:postings.filter(x=>x.role==='UNCLASSIFIED').length},
        revenueAccounts:revenueAccounts.map(x=>({id:x.accountId,name:x.name,type:x.accountType,value:x.value})),
        cogsAccounts:cogsAccounts.map(x=>({id:x.accountId,name:x.name,type:x.accountType,value:x.value})),
        opexAccounts:opexAccounts.map(x=>({id:x.accountId,name:x.name,type:x.accountType,value:x.value}))
      }
    });
  }catch(e){console.error('IIKO P&L ERROR',e);return json({success:false,message:e.message||'Ошибка P&L'},502)}
}
