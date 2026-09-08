// ============================================================
// ANAR SYSTEM — P&L FROM IIKO OLAP
// Revenue: SALES OLAP
// COGS + financial articles: TRANSACTIONS OLAP
// Cash shifts are intentionally NOT used here.
// ============================================================

function corsHeaders(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders()}})}
function clean(v){return String(v??'').trim()}

async function sha1(s){const h=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(s));return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}

async function auth(b){
  const ip=clean(b.ip),port=clean(b.port),login=clean(b.login),password=String(b.password??'');
  if(!ip||!port||!login||!password)throw Error('Заполните IP, порт, логин и пароль iiko');
  const u=`http://${ip}:${port}`,p=await sha1(password);
  const r=await fetch(`${u}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${p}`);
  const t=(await r.text()).trim();
  if(!r.ok||!t)throw Error(`Ошибка авторизации iiko: HTTP ${r.status}`);
  return{u,t};
}

async function get(u,o={}){
  const r=await fetch(u,{...o,headers:{Accept:'application/json',...(o.headers||{})},cache:'no-store'});
  const t=(await r.text()).trim();let p=null;try{p=JSON.parse(t||'{}')}catch{}
  return{r,t,p};
}

function normalizeFields(raw){
  const out=[];
  const add=(name,meta={})=>{
    name=clean(name);if(!name||out.some(x=>x.name.toLowerCase()===name.toLowerCase()))return;
    out.push({name,title:clean(meta.title||meta.caption||meta.label||meta.displayName||meta.name||name),type:clean(meta.type||meta.dataType||meta.kind||'unknown')});
  };
  if(Array.isArray(raw))raw.forEach(x=>typeof x==='string'?add(x):x&&add(x.technicalName||x.field||x.key||x.code||x.id||x.name,x));
  else if(raw&&typeof raw==='object'){
    for(const k of ['fields','columns','dimensions','measures'])if(Array.isArray(raw[k]))raw[k].forEach(x=>typeof x==='string'?add(x):x&&add(x.technicalName||x.field||x.key||x.code||x.id||x.name,x));
    for(const[k,v]of Object.entries(raw))if(!['fields','columns','dimensions','measures','data','items'].includes(k)&&v&&typeof v==='object'&&!Array.isArray(v))add(k,v);
  }
  return out;
}

async function cols(u,t,type){
  const x=await get(`${u}/resto/api/v2/reports/olap/columns?key=${encodeURIComponent(t)}&reportType=${encodeURIComponent(type)}`);
  if(!x.r.ok||!x.p)throw Error(`OLAP ${type}: HTTP ${x.r.status}`);
  return normalizeFields(x.p);
}

function norm(s){return clean(s).toLowerCase().replace(/[\s._()\/-]+/g,'')}
function findField(fs,candidates){
  for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name)===q||norm(f.title)===q);if(x)return x.name}
  for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name).includes(q)||norm(f.title).includes(q));if(x)return x.name}
  return null;
}
function fieldType(fs,name){return String(fs.find(x=>norm(x.name)===norm(name||''))?.type||'').toUpperCase()}
function dateFilter(from,to,type){const d=type==='DATE'||(type.includes('DATE')&&!type.includes('TIME')&&!type.includes('DATETIME'));return{filterType:'DateRange',periodType:'CUSTOM',from:d?from:`${from}T00:00:00.000`,to:d?to:`${to}T23:59:59.999`,includeLow:true,includeHigh:true}}

async function olap(u,t,type,q){
  const req={reportType:type,buildSummary:true,groupByRowFields:q.rows||[],groupByColFields:q.cols||[],aggregateFields:q.measures||[],filters:{...(q.filters||{})}};
  if(q.from&&q.to&&q.dateField)req.filters[q.dateField]=dateFilter(q.from,q.to,String(q.dateType||'').toUpperCase());
  const x=await get(`${u}/resto/api/v2/reports/olap?key=${encodeURIComponent(t)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});
  return{request:req,ok:x.r.ok,report:x.p,error:x.r.ok?null:`HTTP ${x.r.status}: ${x.t.slice(0,1200)}`};
}

function number(v){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  if(v===null||v===undefined||v==='')return 0;
  const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0;
}
function value(row,key){return number(row?.[key]??row?.[String(key).toLowerCase()]??0)}
function allRows(report){return Array.isArray(report?.data)?report.data:[]}
function summaryValue(report,field){
  const s=report?.summary;
  if(Array.isArray(s)&&s.length)return s.reduce((a,r)=>a+value(r,field),0);
  if(s&&typeof s==='object')return value(s,field);
  return allRows(report).reduce((a,r)=>a+value(r,field),0);
}
function rowText(row,field){return clean(row?.[field]??row?.[String(field).toLowerCase()]??'')}

function filterRowsByAccount(rows,accountField,name){
  const target=clean(name).toLowerCase();
  return rows.filter(r=>rowText(r,accountField).toLowerCase()===target);
}

function buildPostingRows(report,articleField,amountField,idField,typeField,incomingField,outgoingField,counterField){
  return allRows(report).map(r=>({
    name:rowText(r,articleField)||'Без статьи',
    value:value(r,amountField),
    incoming:incomingField?value(r,incomingField):0,
    outgoing:outgoingField?value(r,outgoingField):0,
    counterAccount:counterField?rowText(r,counterField):'',
    accountId:idField?rowText(r,idField):'',
    accountType:typeField?rowText(r,typeField):''
  })).filter(x=>x.name);
}

function normalizeCategory(v){const x=clean(v).toUpperCase();return['REVENUE','COGS','OPEX','OTHER_INCOME','OTHER_EXPENSE','EXCLUDED','UNCLASSIFIED'].includes(x)?x:'UNCLASSIFIED'}
function autoCategory(r){
  const t=r.accountType.toLowerCase(),n=r.name.toLowerCase();
  if(/asset|актив|активы|активлар/.test(t))return'EXCLUDED';
  if(/liabil|обязат|borc/.test(t))return'EXCLUDED';
  if(/equity|капитал|капиталı/.test(t))return'EXCLUDED';
  if(/income|доход|gəlir/.test(t))return'REVENUE';
  if(/expense|расход|xərc/.test(t))return'OPEX';
  if(/проч.*доход|other income|digər gəlir/.test(n))return'OTHER_INCOME';
  if(/проч.*расход|other expense|digər xərc/.test(n))return'OTHER_EXPENSE';
  return'UNCLASSIFIED';
}

function signedCategoryValue(category,row){
  const v=Math.abs(number(row.value));
  return category==='COGS'||category==='OPEX'||category==='OTHER_EXPENSE'?-v:v;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}

export async function onRequestPost(c){
  try{
    const b=await c.request.json();
    const from=clean(b.from).slice(0,10),to=clean(b.to||b.from).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({success:false,message:'Укажите корректный период'},400);

    const{u,t}=await auth(b);
    const salesFields=await cols(u,t,'SALES');
    const transactionFields=await cols(u,t,'TRANSACTIONS');

    // --------------------------------------------------------
    // SALES — revenue components directly from iiko OLAP
    // --------------------------------------------------------
    const revenueBase=findField(salesFields,[
      'DishSumInt','Сумма без учета скидок и надбавок','Сумма без учета скидок','Торговая выручка без учета скидок'
    ]);
    const discount=findField(salesFields,[
      'DishDiscountSumInt','Сумма скидки','Скидка','Discount'
    ]);
    const surcharge=findField(salesFields,[
      'DishIncreaseSumInt','Сумма надбавки','Надбавка','Increase','Surcharge'
    ]);
    const salesDate=findField(salesFields,['OpenDate.Typed','OpenDate','Учетный день','Дата']);
    const salesDateType=fieldType(salesFields,salesDate);

    const revenueMeasures=[revenueBase,discount,surcharge].filter(Boolean);
    if(!revenueMeasures.length)throw Error('В OLAP SALES не найдены поля выручки. Откройте диагностику полей и проверьте структуру iiko.');

    const salesQuery=await olap(u,t,'SALES',{rows:[],measures:revenueMeasures,from,to,dateField:salesDate||'OpenDate.Typed',dateType:salesDateType});
    if(!salesQuery.ok)throw Error(`OLAP SALES: ${salesQuery.error}`);

    const revenueBaseValue=revenueBase?summaryValue(salesQuery.report,revenueBase):0;
    const discountValue=discount?summaryValue(salesQuery.report,discount):0;
    const surchargeValue=surcharge?summaryValue(salesQuery.report,surcharge):0;
    const revenue=revenueBaseValue+discountValue+surchargeValue;

    // --------------------------------------------------------
    // TRANSACTIONS — financial postings
    // --------------------------------------------------------
    const article=findField(transactionFields,[
      'Account.Name','AccountName','Счет','Счёт','FinancialArticle','Article','Account'
    ]);
    const amount=findField(transactionFields,['Sum','Сумма','Amount','Value','TransactionSum','MoneySum']);
    const incoming=findField(transactionFields,['Sum.In','SumIncome','Income','Сумма прихода','Приход']);
    const outgoing=findField(transactionFields,['Sum.Out','SumExpense','Expense','Сумма расхода','Расход']);
    const accountId=findField(transactionFields,['Account.Id','Account.ID','AccountId','AccountUUID','Account.Guid','Account.Code']);
    const accountType=findField(transactionFields,['Account.Type','AccountType','Account.TypeName','Account.Kind','Тип счета','Тип счёта','Type']);
    const counterAccount=findField(transactionFields,['CounterAccount.Name','CounterAccountName','Корр.Счет/Склад','Корр. Счет/Склад','CounterAccount']);
    const trDate=findField(transactionFields,['DateTime.DateTyped','DateTime.Typed','DateTime.Date','Date.Typed','Date','TransactionDate','OperationDate','OpenDate.Typed','Учетный день']);
    const trDateType=fieldType(transactionFields,trDate);

    if(!article||!amount)throw Error('В OLAP TRANSACTIONS не найдены поля «Счет» и/или «Сумма».');

    const postingRows=[article];
    for(const f of [accountId,accountType,counterAccount])if(f&&!postingRows.includes(f))postingRows.push(f);

    const postingQuery=await olap(u,t,'TRANSACTIONS',{
      rows:postingRows,
      measures:[amount,...[incoming,outgoing].filter(Boolean)],
      from,to,dateField:trDate||'DateTime.DateTyped',dateType:trDateType
    });
    if(!postingQuery.ok)throw Error(`OLAP TRANSACTIONS: ${postingQuery.error}`);

    const postings=buildPostingRows(postingQuery.report,article,amount,accountId,accountType,incoming,outgoing,counterAccount);

    // --------------------------------------------------------
    // COGS — ONLY the iiko account "Расход продуктов"
    // --------------------------------------------------------
    const cogsPostingRows=filterRowsByAccount(allRows(postingQuery.report),article,'Расход продуктов');
    const cogs=Math.abs(cogsPostingRows.reduce((sum,r)=>sum+value(r,amount),0));

    const saved=Array.isArray(b.mappings)?b.mappings:[];
    const byId=new Map(saved.map(x=>[clean(x.account_id),normalizeCategory(x.pnl_category)]));

    // Do not allow mapping to override the explicit COGS account.
    const accounts=postings.map(x=>{
      const isCogs=x.name.toLowerCase()==='расход продуктов';
      return{...x,pnlCategory:isCogs?'COGS':(byId.get(x.accountId)||autoCategory(x))};
    });

    const financialAccounts=accounts.filter(x=>x.name.toLowerCase()!=='расход продуктов');
    const opex=financialAccounts.filter(x=>x.pnlCategory==='OPEX').reduce((a,x)=>a+Math.abs(x.value),0);
    const otherIncome=financialAccounts.filter(x=>x.pnlCategory==='OTHER_INCOME').reduce((a,x)=>a+Math.abs(x.value),0);
    const otherExpense=financialAccounts.filter(x=>x.pnlCategory==='OTHER_EXPENSE').reduce((a,x)=>a+Math.abs(x.value),0);

    const grossProfit=revenue-cogs;
    const operatingProfit=grossProfit-opex;
    const netProfit=operatingProfit+otherIncome-otherExpense;

    const final=[
      {name:'Выручка',value:revenue,kind:'section',level:true,open:true},
      {name:'Сумма без учета скидок и надбавок',value:revenueBaseValue,kind:'sub'},
      {name:'Сумма скидки',value:discountValue,kind:'sub'},
      {name:'Сумма надбавки',value:surchargeValue,kind:'sub'},
      {name:'Итого выручка',value:revenue,kind:'total'},
      {name:'Себестоимость',value:-cogs,kind:'section',level:true,open:true},
      {name:'Расход продуктов',value:-cogs,kind:'sub'},
      {name:'Валовая прибыль',value:grossProfit,kind:'total'},
      {name:'Операционные расходы',value:-opex,kind:'section',level:true,open:true},
      ...financialAccounts.filter(x=>x.pnlCategory==='OPEX').map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub',accountId:x.accountId,pnlCategory:x.pnlCategory})),
      {name:'Операционная прибыль',value:operatingProfit,kind:'total'},
      {name:'Прочие доходы',value:otherIncome,kind:'section',level:true,open:true},
      ...financialAccounts.filter(x=>x.pnlCategory==='OTHER_INCOME').map(x=>({name:x.name,value:Math.abs(x.value),kind:'sub',accountId:x.accountId,pnlCategory:x.pnlCategory})),
      {name:'Прочие расходы',value:-otherExpense,kind:'section',level:true,open:true},
      ...financialAccounts.filter(x=>x.pnlCategory==='OTHER_EXPENSE').map(x=>({name:x.name,value:-Math.abs(x.value),kind:'sub',accountId:x.accountId,pnlCategory:x.pnlCategory})),
      {name:'ИТОГО ЧИСТАЯ ПРИБЫЛЬ',value:netProfit,kind:'profit'}
    ];

    const warnings=[];
    if(!revenueBase)warnings.push('Не найдено поле «Сумма без учета скидок и надбавок» в SALES.');
    if(!discount)warnings.push('Не найдено поле «Сумма скидки» в SALES.');
    if(!surcharge)warnings.push('Не найдено поле «Сумма надбавки» в SALES.');
    if(!cogsPostingRows.length)warnings.push('В выбранном периоде не найден счёт «Расход продуктов» в TRANSACTIONS.');

    return json({
      success:true,
      from,to,
      revenue,
      revenueBase:revenueBaseValue,
      discount:discountValue,
      surcharge:surchargeValue,
      cogs,
      grossProfit,
      opex,
      operatingProfit,
      otherIncome,
      otherExpense,
      netProfit,
      rows:final,
      accounts,
      salesFields,
      transactionFields,
      sourceNote:'iiko Server · OLAP SALES + OLAP TRANSACTIONS · без кассовых смен',
      mapping:{revenueBase,discount,surcharge,salesDate,trDate,article,amount,incoming,outgoing,accountId,accountType,counterAccount,salesDateType,trDateType},
      diagnostics:{cogsAccount:'Расход продуктов',cogsRows:cogsPostingRows.length,cogsAmount:cogs},
      warnings
    });
  }catch(e){return json({success:false,message:e?.message||'Ошибка построения P&L'},502)}
}
