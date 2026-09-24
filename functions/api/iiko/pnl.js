// ============================================================
// ANAR SYSTEM — P&L FROM IIKO
// Revenue: TRANSACTIONS OLAP by Account.Type
// COGS / OPEX / other blocks: TRANSACTIONS OLAP by Account.Type
// Cash shifts are intentionally NOT used here.
//
// IMPORTANT:
// P&L block membership is determined by Account.Type, NOT Account.Name.
// Account.Id is the stable grouping identifier.
// Account.Name is display-only.
// ============================================================

import { clean, getOlapFields, iikoJson } from './_lib/iiko-client.js';

function corsHeaders(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders()}})}
function norm(s){return clean(s).toLowerCase().replace(/[\s._()\/-]+/g,'')}
function findField(fs,candidates){for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name)===q||norm(f.title)===q);if(x)return x.name}for(const c of candidates){const q=norm(c),x=fs.find(f=>norm(f.name).includes(q)||norm(f.title).includes(q));if(x)return x.name}return null}
function endExclusive(to){const d=new Date(`${to}T00:00:00`);d.setDate(d.getDate()+1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dateFilter(from,to){return{filterType:'DateRange',periodType:'CUSTOM',from,to:endExclusive(to)}}
function departmentFilter(ids){return{filterType:'IncludeValues',values:[...new Set((ids||[]).map(String).filter(Boolean))]}}
async function olap(connection,type,q){const req={reportType:type,buildSummary:true,groupByRowFields:q.rows||[],groupByColFields:q.cols||[],aggregateFields:q.measures||[],filters:{...(q.filters||{})}};if(q.from&&q.to&&q.dateField)req.filters[q.dateField]=dateFilter(q.from,q.to);if(q.departmentIds?.length&&q.departmentField)req.filters[q.departmentField]=departmentFilter(q.departmentIds);const x=await iikoJson(connection,'/resto/api/v2/reports/olap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});return{request:req,ok:x.ok,report:x.payload,error:x.ok?null:`HTTP ${x.status}: ${x.text.slice(0,2000)}`}}
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

    const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??'')};
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return json({success:false,message:'Заполните IP, порт, логин и пароль iiko'},400);
    const departmentIds=Array.isArray(b.departmentIds)?[...new Set(b.departmentIds.map(String).filter(Boolean))]:[];
    const allDepartmentIds=Array.isArray(b.allDepartmentIds)?[...new Set(b.allDepartmentIds.map(String).filter(Boolean))]:departmentIds;
    const selectedSet=new Set(departmentIds);
    const allSet=new Set(allDepartmentIds);
    const isPartialRestaurantSelection=allSet.size>0&&selectedSet.size>0&&(
      selectedSet.size!==allSet.size||[...selectedSet].some(id=>!allSet.has(id))
    );

    const [salesMeta,transactionMeta]=await Promise.all([
      getOlapFields(connection,'SALES'),
      getOlapFields(connection,'TRANSACTIONS')
    ]);
    const salesFields=salesMeta.fields;
    const transactionFields=transactionMeta.fields;

    // ------------------------------------------------------------
    // SALES OLAP: analytics by category only.
    // P&L revenue amounts are NOT taken from SALES.
    // ------------------------------------------------------------
    const salesBase=findField(salesFields,['DishDiscountSumInt','Сумма со скидкой','Сумма с учетом скидок','DishSumInt','Сумма без учета скидок и надбавок','Сумма без скидки','Сумма без скидок','Торговая выручка без учета скидок']);
    const category=findField(salesFields,['DishCategory','DishCategory.Name','DishCategoryName','Category','Category.Name','CategoryName','Категория блюда']);
    const salesDate=findField(salesFields,['OpenDate.Typed','OpenDate','Учетный день','Дата']);
    const salesDepartment=findField(salesFields,['Department.Id','Department.ID','DepartmentId','Department.Guid','Department.UUID','Department.Uuid']);
    if(!salesBase)throw Error('В OLAP SALES не найдено поле для суммы продаж.');
    if(!category)throw Error('В OLAP SALES не найдено поле «Категория блюда».');

    // ------------------------------------------------------------
    // TRANSACTIONS OLAP: P&L blocks by Account.Type.
    // Account.Id is the stable grouping key; Account.Name is display-only.
    // ------------------------------------------------------------
    const article=findField(transactionFields,['Account.Name','AccountName','Счет','Счёт','FinancialArticle','Article','Account']);
    const amount=findField(transactionFields,['Sum','Сумма','Amount','Value','TransactionSum','MoneySum']);
    const accountId=findField(transactionFields,['Account.Id','Account.ID','AccountId','AccountUUID','Account.Guid','Account.Code']);
    const accountType=findField(transactionFields,['Account.Type','AccountType','Account.TypeName','Account.Kind','Тип счета','Тип счёта','Type']);
    const counterAccount=findField(transactionFields,['CounterAccount.Name','CounterAccountName','Корр.Счет/Склад','Корр. Счет/Склад','CounterAccount']);
    const trDate=findField(transactionFields,['DateTime.DateTyped','DateTime.Typed','DateTime.Date','Date.Typed','Date','TransactionDate','OperationDate','OpenDate.Typed','Учетный день']);
    const transactionDepartment=findField(transactionFields,['Department.Id','Department.ID','DepartmentId','Department.Guid','Department.UUID','Department.Uuid','Transaction.DepartmentId','Transaction.Department.Id']);
    if(!article||!amount)throw Error('В OLAP TRANSACTIONS не найдены поля «Счет» и/или «Сумма».');
    if(!accountType)throw Error('В OLAP TRANSACTIONS не найдено поле «Тип счета».');

    // SALES must stay restaurant-scoped. Some iiko TRANSACTIONS versions do
    // not expose Department.Id. Server-wide TRANSACTIONS is acceptable only
    // when the user selected the entire known restaurant scope; otherwise the
    // report would mix one restaurant's SALES with the whole network finances.
    if(departmentIds.length&&!salesDepartment)throw Error('В OLAP SALES не найден Department.Id для фильтра выбранного ресторана.');
    if(isPartialRestaurantSelection&&!transactionDepartment){
      return json({
        success:false,
        code:'PNL_TRANSACTION_SCOPE_UNSAFE',
        message:'Нельзя построить P&L для части сети: SH TRANSACTIONS не отдаёт Department.Id. Выберите все рестораны либо используйте SH Server, где финансовые проводки содержат подразделение.'
      },409);
    }
    const transactionDepartmentScopeApplied=departmentIds.length>0&&!!transactionDepartment;
    const serverWideAllRestaurants=departmentIds.length>0&&!transactionDepartment&&!isPartialRestaurantSelection;
    const scopeWarning=null;

    const postingRows=[article,accountType];
    for(const f of[accountId,counterAccount])if(f&&!postingRows.includes(f))postingRows.push(f);

    const [categoryQuery,postingQuery]=await Promise.all([
      olap(connection,'SALES',{rows:[category],measures:[salesBase],from,to,dateField:salesDate||'OpenDate.Typed',departmentIds,departmentField:salesDepartment}),
      olap(connection,'TRANSACTIONS',{rows:postingRows,measures:[amount],from,to,dateField:trDate||'DateTime.DateTyped',departmentIds:transactionDepartment?departmentIds:[],departmentField:transactionDepartment})
    ]);
    if(!categoryQuery.ok)throw Error(`OLAP SALES по категориям: ${categoryQuery.error}`);
    if(!postingQuery.ok)throw Error(`OLAP TRANSACTIONS: ${postingQuery.error}`);

    const categoryRows=allRows(categoryQuery.report).map(r=>({
      name:rowText(r,category)||'Без категории',
      base:value(r,salesBase),
      value:value(r,salesBase)
    })).filter(x=>x.name&&Math.abs(x.value)>0.000001);
    const categoryBase=sumField(categoryQuery.report,salesBase);
    const categoryRevenue=categoryBase;

    // Empty SALES rows are valid: the restaurant can have expenses/postings
    // in a period without sales. P&L must still be generated from transactions.
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

    // IMPORTANT: Revenue is only the sum of TRANSACTIONS revenue accounts.
    // Account.Name is never used for classification and is never hard-coded.
    const tradingRevenue=accountRoleTotal(revenueAccounts);
    const revenue=tradingRevenue;

    const cogs=Math.abs(accountRoleTotal(cogsAccounts));
    const opex=Math.abs(accountRoleTotal(opexAccounts));
    const otherIncome=Math.abs(accountRoleTotal(otherIncomeAccounts));
    const otherExpense=Math.abs(accountRoleTotal(otherExpenseAccounts));
    const grossProfit=revenue-cogs;
    const operatingProfit=grossProfit-opex;
    const netProfit=operatingProfit+otherIncome-otherExpense;

    // Exact hierarchy: Выручка -> Торговая выручка -> iiko Account.Name rows.
    // Totals are calculated from the same rows that are displayed.
    const tradingRevenueRows=revenueAccounts.map(x=>({name:x.name,value:x.value,kind:'sub',accountId:x.accountId,accountType:x.accountType}));
    const tradingRevenueTotal=tradingRevenueRows.reduce((a,x)=>a+Number(x.value||0),0);
    const revenueRows=[
      {name:'Выручка',value:tradingRevenueTotal,kind:'section',level:true,open:true},
      {name:'Торговая выручка',value:tradingRevenueTotal,kind:'section',level:true,open:true},
      ...tradingRevenueRows,
      {name:'Итого Торговая выручка',value:tradingRevenueTotal,kind:'total'},
      {name:'Итого Выручка',value:tradingRevenueTotal,kind:'total'}
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
      revenue:tradingRevenueTotal,
      revenueBase:tradingRevenue,
      revenueAccounts:{
        tradingRevenue:tradingRevenueTotal,
        transactionRevenueTotal:tradingRevenue,
        totalRevenue:tradingRevenueTotal,
        source:'TRANSACTIONS Account.Type'
      },
      revenueCategories:categoryRows.sort((a,b)=>b.value-a.value).map(x=>({name:x.name,value:x.value,share:categoryRevenue?x.value/categoryRevenue*100:0,base:x.base})),
      categoryRevenue,
      cogs,opex,otherIncome,otherExpense,grossProfit,operatingProfit,netProfit,
      rows:final,
      accounts:postings.map(x=>({...x,pnlCategory:x.role})),
      accountTypeSummary:{REVENUE:revenueAccounts,COGS:cogsAccounts,OPEX:opexAccounts,OTHER_INCOME:otherIncomeAccounts,OTHER_EXPENSE:otherExpenseAccounts},
      salesFields,transactionFields,
      sourceNote:`iiko Server · P&L блоки определяются по Account.Type; Account.Id используется для группировки; Account.Name берётся напрямую из iiko · P&L выручка: TRANSACTIONS · без кассовых смен${serverWideAllRestaurants?' · TRANSACTIONS: вся выбранная сеть':''}`,
      meta:{
        departmentIds,
        allDepartmentIds,
        isPartialRestaurantSelection,
        serverWideAllRestaurants,
        departmentScopeApplied:departmentIds.length>0&&!!salesDepartment&&(!!transactionDepartment||serverWideAllRestaurants),
        salesDepartmentScopeApplied:departmentIds.length>0&&!!salesDepartment,
        transactionDepartmentScopeApplied,
        scopeWarning,
        salesDepartmentField:salesDepartment||null,
        transactionDepartmentField:transactionDepartment||null,
        salesFieldsCacheHit:salesMeta.cacheHit,
        transactionFieldsCacheHit:transactionMeta.cacheHit
      }
    });
  }catch(e){console.error('IIKO P&L ERROR',e);return json({success:false,message:e.message||'Ошибка P&L'},502)}
}
