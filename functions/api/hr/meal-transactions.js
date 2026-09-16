import { getOlapFields, iikoJson } from '../iiko/_lib/iiko-client.js';
import { loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function monthOnly(v){return /^\d{4}-\d{2}$/.test(clean(v))?clean(v):''}
function monthBounds(month){const[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`,yearStart:`${y}-01-01`}}
function nextDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
function now(){return new Date().toISOString()}
function norm(v){return clean(v).toLowerCase().replace(/ё/g,'е').replace(/[\s._()\/-]+/g,'')}
function idValue(v){const raw=v&&typeof v==='object'?(v.id??v.uuid??v.entityId??v.counteragentId??v.accountId):v;return clean(raw).replace(/^\{+|\}+$/g,'').toLowerCase()}
function asArray(payload){if(Array.isArray(payload))return payload;for(const k of['items','data','rows','accounts'])if(Array.isArray(payload?.[k]))return payload[k];return[]}
function numeric(v){if(typeof v==='number')return Number.isFinite(v)?v:0;if(v===null||v===undefined||v==='')return 0;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0}
function findField(fields,candidates){for(const c of candidates){const q=norm(c),f=fields.find(x=>norm(x.name)===q||norm(x.title)===q);if(f)return f.name}for(const c of candidates){const q=norm(c),f=fields.find(x=>norm(x.name).includes(q)||norm(x.title).includes(q));if(f)return f.name}return null}
function rowText(row,field){return field?clean(row?.[field]??row?.[String(field).toLowerCase()]??''):''}
function rowNumber(row,field){return field?numeric(row?.[field]??row?.[String(field).toLowerCase()]??0):0}
function unique(items){return[...new Set(items.filter(Boolean))]}
function mealAccountName(v){const n=norm(v);return n.includes(norm('Текущие расчеты с сотрудниками'))||n.includes(norm('Текущие расчёты с сотрудниками'))||n.includes(norm('Задолженность сотрудников'))||n.includes(norm('Кредиты сотрудникам'))||n.includes('employeesettlement')||n.includes('employeedebt')||n.includes('employeecredit')}
function transactionKind(v){const raw=clean(v).toUpperCase().replace(/\s+/g,'');const latin=raw.replace(/КРЕД/g,'KRED');if(['CRED','KRED','CREDIT','CLOSEMP'].includes(latin))return latin;return''}
function transactionClass(kind){return kind==='CLOSEMP'?'REPAY':'CHARGE'}
function mealAmount(row,fields){const vals=[rowNumber(row,fields.sum),rowNumber(row,fields.incoming),rowNumber(row,fields.outgoing)].filter(v=>Math.abs(v)>0.000001);return vals.length?money(Math.abs(vals[0])):0}
function dateKey(v){const m=clean(v).match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:''}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_meal_monthly (
    user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,month TEXT NOT NULL,opening_debt REAL NOT NULL DEFAULT 0,closing_debt REAL NOT NULL DEFAULT 0,
    month_net_increase REAL NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'MANUAL',synced_at TEXT NOT NULL DEFAULT '',details_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY(user_id,iiko_employee_id,month)
  )`).run();
}

async function employees(db,userId){
  const r=await db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_name,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>''`).bind(userId).all();
  return(r.results||[]).filter(e=>!Number(e.is_deleted)).map(e=>{
    const id=String(e.iiko_employee_id),name=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||id;
    return{id,idKey:id.toLowerCase(),code:e.employee_code||'',name,displayName:e.display_name||'',roleName:e.role_name||''};
  });
}

async function accountCandidates(connection){
  const r=await iikoJson(connection,'/resto/api/v2/entities/accounts/list?includeDeleted=false&revisionFrom=-1');
  if(!r.ok||!r.payload)throw new Error(`Не удалось получить счета iiko: HTTP ${r.status}`);
  const all=asArray(r.payload).map(a=>({id:idValue(a.id??a.Id),name:clean(a.name??a.Name),type:clean(a.type??a.Type),code:clean(a.code??a.Code)})).filter(a=>a.id);
  const matched=all.filter(a=>mealAccountName(`${a.name} ${a.type} ${a.code}`));
  if(!matched.length)throw new Error('Не найден счёт «Текущие расчёты с сотрудниками». Проверьте название счёта в iiko.');
  return{all,matched,ids:new Set(matched.map(a=>a.id)),names:new Set(matched.map(a=>norm(a.name)))};
}

async function transactionFields(connection){
  const meta=await getOlapFields(connection,'TRANSACTIONS'),fs=meta.fields||[];
  const f={
    accountId:findField(fs,['Account.Id','Account.ID','AccountId','Account.Guid','Account.UUID']),
    accountName:findField(fs,['Account.Name','AccountName','Счет','Счёт','Account']),
    counterAccountId:findField(fs,['Contr-Account.Id','Contr-Account.ID','CounterAccount.Id','CounterAccount.ID','CounterAccountId','CounterAccount.Guid','CounterAccount.UUID']),
    counterAccount:findField(fs,['Contr-Account.Name','CounterAccount.Name','CounterAccountName','Корр.Счет/Склад','Корр. Счет/Склад']),
    counteragentId:findField(fs,['Counteragent.Id','Counteragent.ID','CounteragentId','Counteragent.Guid','Counteragent.UUID','Contractor.Id','ContractorId']),
    counteragentName:findField(fs,['Counteragent.Name','CounteragentName','Contractor.Name','ContractorName','Сотрудник','Контрагент']),
    type:findField(fs,['TransactionType.Code','TransactionType','Transaction.Type','TransactionTypeCode','Тип проводки','Тип']),
    date:findField(fs,['DateTime.DateTyped','DateTime.Typed','DateTime.Date','Date.Typed','Date','TransactionDate','OperationDate']),
    sum:findField(fs,['Sum','TransactionSum','Amount','Сумма']),
    incoming:findField(fs,['Sum.Incoming','IncomingSum','Debit','Дебет']),
    outgoing:findField(fs,['Sum.Outgoing','OutgoingSum','Credit','Кредит'])
  };
  if(!f.type)throw new Error('В OLAP TRANSACTIONS не найдено поле TransactionType.');
  if(!f.date)throw new Error('В OLAP TRANSACTIONS не найдено поле даты проводки.');
  if(!f.counteragentId&&!f.counteragentName)throw new Error('В OLAP TRANSACTIONS не найден сотрудник/контрагент.');
  if(!f.sum&&!f.incoming&&!f.outgoing)throw new Error('В OLAP TRANSACTIONS не найдено поле суммы.');
  return f;
}

async function transactionRows(connection,fields,bounds){
  const rows=unique([fields.date,fields.accountId,fields.accountName,fields.counterAccountId,fields.counterAccount,fields.counteragentId,fields.counteragentName,fields.type]);
  const measures=unique([fields.sum,fields.incoming,fields.outgoing]);
  const filters={};
  filters[fields.date]={filterType:'DateRange',periodType:'CUSTOM',from:bounds.yearStart,to:nextDate(bounds.to),includeLow:true,includeHigh:false};
  const request={reportType:'TRANSACTIONS',buildSummary:false,groupByRowFields:rows,groupByColFields:[],aggregateFields:measures,filters};
  const r=await iikoJson(connection,'/resto/api/v2/reports/olap',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(request)});
  if(!r.ok||!r.payload)throw new Error(`OLAP TRANSACTIONS HTTP ${r.status}: ${r.text.slice(0,1000)}`);
  return{rows:asArray(r.payload),request};
}

function employeeNameMap(list){
  const m=new Map();
  for(const e of list){for(const raw of[e.name,e.displayName,e.code]){const key=norm(raw);if(!key)continue;const old=m.get(key);if(old&&old!==e.idKey)m.set(key,'');else if(!m.has(key))m.set(key,e.idKey)}}
  return m;
}
function sideMatches(row,fields,accounts){
  const aid=fields.accountId?idValue(rowText(row,fields.accountId)):'';
  const aname=fields.accountName?norm(rowText(row,fields.accountName)):'';
  const cid=fields.counterAccountId?idValue(rowText(row,fields.counterAccountId)):'';
  const cname=fields.counterAccount?norm(rowText(row,fields.counterAccount)):'';
  return Boolean((aid&&accounts.ids.has(aid))||(aname&&accounts.names.has(aname))||(cid&&accounts.ids.has(cid))||(cname&&accounts.names.has(cname)));
}

async function sync(request,env,userId,month){
  const state=await loadRequestIikoState(request,env);if(!state?.user||String(state.user.id)!==String(userId))throw new Error('Требуется авторизация');
  if(!state.found||!hasPrivateConnection(state.state))throw new Error('Сначала подключите SH Server в настройках.');
  const connection=privateConnection(state.state),bounds=monthBounds(month),list=await employees(env.DB,userId),employeeIds=new Set(list.map(e=>e.idKey)),nameMap=employeeNameMap(list);
  const accounts=await accountCandidates(connection),fields=await transactionFields(connection),tx=await transactionRows(connection,fields,bounds);
  const spent=new Map(),repaid=new Map(),beforeCharges=new Map(),beforeRepayments=new Map(),currentTypes=new Map(),historyTypes=new Map(),unmatched=[],matchedRows=[];
  let matchedHistoryTransactions=0,matchedCurrentTransactions=0;
  for(const row of tx.rows){
    const kind=transactionKind(rowText(row,fields.type));
    if(!kind||!sideMatches(row,fields,accounts))continue;
    const day=dateKey(rowText(row,fields.date));if(!day)continue;
    let eid=fields.counteragentId?idValue(rowText(row,fields.counteragentId)):'';
    const employeeName=fields.counteragentName?rowText(row,fields.counteragentName):'';
    if(!employeeIds.has(eid)){const byName=nameMap.get(norm(employeeName));eid=byName||''}
    const amount=mealAmount(row,fields);if(amount<=0)continue;
    historyTypes.set(kind,(historyTypes.get(kind)||0)+1);
    if(!eid||!employeeIds.has(eid)){if(unmatched.length<20)unmatched.push({date:day,employeeName,type:kind,amount,account:rowText(row,fields.accountName),counterAccount:rowText(row,fields.counterAccount)});continue}
    matchedHistoryTransactions++;
    const cls=transactionClass(kind),isBefore=day<bounds.from,isCurrent=day>=bounds.from&&day<=bounds.to;
    if(isBefore){const target=cls==='CHARGE'?beforeCharges:beforeRepayments;target.set(eid,(target.get(eid)||0)+amount)}
    if(isCurrent){
      matchedCurrentTransactions++;currentTypes.set(kind,(currentTypes.get(kind)||0)+1);
      const target=cls==='CHARGE'?spent:repaid;target.set(eid,(target.get(eid)||0)+amount);
      if(matchedRows.length<40)matchedRows.push({date:day,employeeId:eid,employeeName,type:kind,class:cls,amount,account:rowText(row,fields.accountName),counterAccount:rowText(row,fields.counterAccount)});
    }
  }
  const t=now(),statements=[];
  for(const e of list){
    const historicalCharges=money(beforeCharges.get(e.idKey)||0),historicalRepayments=money(beforeRepayments.get(e.idKey)||0);
    const opening=money(Math.max(0,historicalCharges-historicalRepayments)),used=money(spent.get(e.idKey)||0),paid=money(repaid.get(e.idKey)||0),closing=money(Math.max(0,opening+used-paid));
    const details={mode:'KRED_ONLY_V2',spent:used,repaid:paid,openingDebt:opening,closingDebt:closing,historicalCharges,historicalRepayments,transactionTypes:Object.fromEntries(currentTypes),historyTransactionTypes:Object.fromEntries(historyTypes),mealAccountIds:[...accounts.ids],mealAccounts:accounts.matched,olapFields:fields,historyFrom:bounds.yearStart,syncedAt:t};
    statements.push(env.DB.prepare(`INSERT INTO hr_employee_meal_monthly(user_id,iiko_employee_id,month,opening_debt,closing_debt,month_net_increase,source,synced_at,details_json) VALUES(?1,?2,?3,?4,?5,?6,'IIKO_MEAL_TRANSACTIONS',?7,?8) ON CONFLICT(user_id,iiko_employee_id,month) DO UPDATE SET opening_debt=excluded.opening_debt,closing_debt=excluded.closing_debt,month_net_increase=excluded.month_net_increase,source=excluded.source,synced_at=excluded.synced_at,details_json=excluded.details_json`).bind(userId,e.id,month,opening,closing,used,t,JSON.stringify(details)));
  }
  for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
  return{matchedTransactions:matchedCurrentTransactions,matchedHistoryTransactions,totalTransactionRows:tx.rows.length,transactionTypes:Object.fromEntries(currentTypes),historyTransactionTypes:Object.fromEntries(historyTypes),unmatched,matchedSample:matchedRows,mealAccounts:accounts.matched,fields,historyFrom:bounds.yearStart,balanceEndpointUsed:false,request:tx.request};
}

async function records(db,userId,month){
  const r=await db.prepare(`SELECT iiko_employee_id,opening_debt,closing_debt,month_net_increase,source,synced_at,details_json FROM hr_employee_meal_monthly WHERE user_id=?1 AND month=?2`).bind(userId,month).all();
  return(r.results||[]).map(x=>{let d={};try{d=JSON.parse(x.details_json||'{}')}catch(_){d={}}return{employeeId:x.iiko_employee_id,openingDebt:money(x.opening_debt),closingDebt:money(x.closing_debt),spent:money(d.spent??x.month_net_increase),repaid:money(d.repaid??Math.max(0,Number(x.opening_debt||0)+Number(x.month_net_increase||0)-Number(x.closing_debt||0))),source:x.source||'',syncedAt:x.synced_at||'',details:d}})
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const url=new URL(request.url),month=monthOnly(url.searchParams.get('month'));if(!month)return json({success:false,message:'Укажите месяц YYYY-MM'},400);return json({success:true,month,records:await records(env.DB,state.user.id,month)})}catch(e){console.error('[HR-MEAL-TX-GET]',e);return json({success:false,message:e?.message||String(e)},500)}}
export async function onRequestPost({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const b=await request.json().catch(()=>({})),month=monthOnly(b.month),action=clean(b.action);if(!month)return json({success:false,message:'Укажите месяц YYYY-MM'},400);if(action!=='sync')return json({success:false,message:'Неизвестное действие'},400);const diagnostics=await sync(request,env,state.user.id,month);return json({success:true,month,records:await records(env.DB,state.user.id,month),diagnostics})}catch(e){console.error('[HR-MEAL-TX-POST]',e);return json({success:false,message:e?.message||String(e)},500)}}