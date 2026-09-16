import { getOlapFields, iikoJson } from '../iiko/_lib/iiko-client.js';
import { loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function numeric(v){if(typeof v==='number')return Number.isFinite(v)?v:0;if(v===null||v===undefined||v==='')return 0;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0}
function norm(v){return clean(v).toLowerCase().replace(/ё/g,'е').replace(/[\s._()\[\]{}\/-]+/g,'')}
function idValue(v){const raw=v&&typeof v==='object'?(v.id??v.uuid??v.entityId??v.counteragentId??v.accountId):v;return clean(raw).replace(/^\{+|\}+$/g,'').toLowerCase()}
function unique(a){return[...new Set((a||[]).filter(Boolean))]}
function asArray(payload){if(Array.isArray(payload))return payload;for(const k of['items','data','rows','accounts'])if(Array.isArray(payload?.[k]))return payload[k];return[]}
function monthOnly(v){return /^\d{4}-\d{2}$/.test(clean(v))?clean(v):''}
function monthBounds(month){const[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`,yearStart:`${y}-01-01`}}
function nextDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
function now(){return new Date().toISOString()}
function dateKey(v){const s=clean(v);let m=s.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);if(m)return`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;m=s.match(/(\d{1,2})[-./](\d{1,2})[-./](20\d{2})/);return m?`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`:''}
function rowValue(row,field){if(!field)return undefined;if(Object.prototype.hasOwnProperty.call(row,field))return row[field];const low=String(field).toLowerCase();for(const[k,v]of Object.entries(row||{}))if(String(k).toLowerCase()===low)return v;return undefined}
function fieldKey(f){return norm(`${f?.name||''} ${f?.title||''}`)}
function fieldNames(fields,predicate,limit=20){return unique((fields||[]).filter(predicate).map(f=>f.name)).slice(0,limit)}
function includesAny(s,parts){return parts.some(p=>s.includes(norm(p)))}
function mealAccountName(v){const n=norm(v);return includesAny(n,['Текущие расчеты с сотрудниками','Текущие расчёты с сотрудниками','Задолженность сотрудников','Кредиты сотрудникам','employee settlement','employee debt','employee credit'])}
function txKind(v){let s=clean(v).toUpperCase().replace(/\s+/g,'').replace(/[._-]+/g,'');s=s.replace(/КРЕДИТ/g,'CREDIT').replace(/КРЕД/g,'KRED');if(s==='CRED'||s==='KRED'||s==='CREDIT')return'CHARGE';if(s==='CLOSEMP'||s.includes('CLOSEMP'))return'REPAY';return''}

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
  return(r.results||[]).filter(e=>!Number(e.is_deleted)).map(e=>{const id=String(e.iiko_employee_id),name=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||id;return{id,idKey:id.toLowerCase(),code:clean(e.employee_code),name,displayName:clean(e.display_name),roleName:clean(e.role_name)}})
}

function employeeLookup(list){
  const ids=new Map(),names=new Map();
  const add=(map,key,id)=>{key=norm(key);if(!key)return;const prev=map.get(key);if(prev&&prev!==id)map.set(key,'');else if(!map.has(key))map.set(key,id)};
  for(const e of list){ids.set(e.idKey,e.idKey);for(const v of[e.name,e.displayName,e.code])add(names,v,e.idKey)}
  return{ids,names};
}

async function mealAccounts(connection){
  const r=await iikoJson(connection,'/resto/api/v2/entities/accounts/list?includeDeleted=false&revisionFrom=-1');
  if(!r.ok||!r.payload)throw new Error(`Не удалось получить счета iiko: HTTP ${r.status}`);
  const all=asArray(r.payload).map(a=>({id:idValue(a.id??a.Id),name:clean(a.name??a.Name),type:clean(a.type??a.Type),code:clean(a.code??a.Code)})).filter(a=>a.id);
  const matched=all.filter(a=>mealAccountName(`${a.name} ${a.type} ${a.code}`));
  if(!matched.length)throw new Error('Не найден счёт «Текущие расчёты с сотрудниками».');
  return{matched,ids:new Set(matched.map(a=>a.id)),names:new Set(matched.map(a=>norm(a.name)))};
}

function discover(meta){
  const fs=meta.fields||[];
  const typeFields=fieldNames(fs,f=>{const k=fieldKey(f);return k.includes('transactiontype')||k.includes('operationtype')||k.includes('типпроводк')||k==='тип'||k.endsWith('тип')},8);
  const dateFields=fieldNames(fs,f=>{const k=fieldKey(f),t=norm(f.type);return k.includes('date')||k.includes('дата')||t.includes('date')||t.includes('time')},8);
  const accountFields=fieldNames(fs,f=>{const k=fieldKey(f);return (k.includes('account')||k.includes('счет')||k.includes('счёт'))&&!k.includes('counteragent')&&!k.includes('contractor')},16);
  const agentFields=fieldNames(fs,f=>{const k=fieldKey(f);return k.includes('counteragent')||k.includes('contractor')||k.includes('контрагент')||k.includes('сотрудник')||k.includes('employee')},16);
  let amountFields=fieldNames(fs,f=>{const k=fieldKey(f);return includesAny(k,['sum.incoming','sum.outgoing','incoming sum','outgoing sum','debit','credit','дебет','кредит','transactionsum','amount'])||k==='sum'||k.endsWith('sum')},12);
  const preferredAmount=['Sum.Incoming','Sum.Outgoing','Debit','Credit','Sum','TransactionSum','Amount'];
  amountFields=unique([...preferredAmount.filter(n=>fs.some(f=>String(f.name).toLowerCase()===n.toLowerCase())),...amountFields]);
  let preferredDate=dateFields.find(n=>/DateTime\.DateTyped/i.test(n))||dateFields.find(n=>/DateTyped/i.test(n))||dateFields.find(n=>/TransactionDate|OperationDate/i.test(n))||dateFields[0]||'';
  if(!preferredDate)throw new Error('В TRANSACTIONS не найдено поле даты.');
  if(!amountFields.length)throw new Error('В TRANSACTIONS не найдены поля суммы/дебета/кредита.');
  if(!typeFields.length)throw new Error('В TRANSACTIONS не найдены поля типа проводки.');
  return{typeFields,dateFields,preferredDate,accountFields,agentFields,amountFields};
}

function compactFields(d){return unique([d.preferredDate,...d.typeFields,...d.accountFields,...d.agentFields]).slice(0,32)}
async function loadTransactions(connection,d,bounds){
  const rows=compactFields(d),measures=unique(d.amountFields).slice(0,10),filters={};
  filters[d.preferredDate]={filterType:'DateRange',periodType:'CUSTOM',from:bounds.yearStart,to:nextDate(bounds.to),includeLow:true,includeHigh:false};
  const request={reportType:'TRANSACTIONS',buildSummary:false,groupByRowFields:rows,groupByColFields:[],aggregateFields:measures,filters};
  const r=await iikoJson(connection,'/resto/api/v2/reports/olap',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(request)});
  if(!r.ok||!r.payload)throw new Error(`OLAP TRANSACTIONS HTTP ${r.status}: ${r.text.slice(0,700)}`);
  return{rows:asArray(r.payload),request};
}

function detectKind(row,d){
  for(const f of d.typeFields){const k=txKind(rowValue(row,f));if(k)return{k,raw:clean(rowValue(row,f)),field:f}}
  for(const[k,v]of Object.entries(row||{})){const kind=txKind(v);if(kind)return{k:kind,raw:clean(v),field:k}}
  return{k:'',raw:'',field:''}
}
function detectDate(row,d){
  for(const f of unique([d.preferredDate,...d.dateFields])){const x=dateKey(rowValue(row,f));if(x)return x}
  for(const v of Object.values(row||{})){const x=dateKey(v);if(x)return x}
  return''
}
function accountMatch(row,d,accounts){
  for(const f of d.accountFields){const v=rowValue(row,f),id=idValue(v),n=norm(v);if((id&&accounts.ids.has(id))||(n&&accounts.names.has(n))||mealAccountName(v))return{ok:true,field:f,value:clean(v)}}
  for(const[k,v]of Object.entries(row||{})){const key=norm(k);if(!(key.includes('account')||key.includes('счет')||key.includes('счёт')))continue;const id=idValue(v),n=norm(v);if((id&&accounts.ids.has(id))||(n&&accounts.names.has(n))||mealAccountName(v))return{ok:true,field:k,value:clean(v)}}
  return{ok:false,field:'',value:''}
}
function detectEmployee(row,d,lookup){
  const candidates=[];
  for(const f of d.agentFields)candidates.push([f,rowValue(row,f)]);
  for(const[k,v]of Object.entries(row||{})){const key=norm(k);if(key.includes('counteragent')||key.includes('contractor')||key.includes('контрагент')||key.includes('сотрудник')||key.includes('employee'))candidates.push([k,v])}
  for(const[f,v]of candidates){const id=idValue(v);if(lookup.ids.has(id))return{id,field:f,value:clean(v)};const byName=lookup.names.get(norm(v));if(byName)return{id:byName,field:f,value:clean(v)}}
  for(const[k,v]of Object.entries(row||{})){const id=idValue(v);if(lookup.ids.has(id))return{id,field:k,value:clean(v)};const byName=lookup.names.get(norm(v));if(byName)return{id:byName,field:k,value:clean(v)}}
  return{id:'',field:'',value:''}
}
function detectAmount(row,d){
  let best=0,bestField='';
  for(const f of d.amountFields){const n=Math.abs(numeric(rowValue(row,f)));if(n>best){best=n;bestField=f}}
  return{amount:money(best),field:bestField}
}

async function sync(request,env,userId,month){
  const state=await loadRequestIikoState(request,env);if(!state?.user||String(state.user.id)!==String(userId))throw new Error('Требуется авторизация');
  if(!state.found||!hasPrivateConnection(state.state))throw new Error('Сначала подключите SH Server в настройках.');
  const connection=privateConnection(state.state),bounds=monthBounds(month),list=await employees(env.DB,userId),lookup=employeeLookup(list),accounts=await mealAccounts(connection),meta=await getOlapFields(connection,'TRANSACTIONS',{force:true}),d=discover(meta),tx=await loadTransactions(connection,d,bounds);
  const spent=new Map(),repaid=new Map(),beforeSpent=new Map(),beforeRepaid=new Map(),matched=[],unmatched=[],rawKinds=new Map();
  let accountRows=0,kredRows=0;
  for(const row of tx.rows){
    const account=accountMatch(row,d,accounts);if(!account.ok)continue;accountRows++;
    const kind=detectKind(row,d);if(!kind.k)continue;kredRows++;rawKinds.set(kind.raw,(rawKinds.get(kind.raw)||0)+1);
    const date=detectDate(row,d);if(!date)continue;
    const employee=detectEmployee(row,d,lookup),amt=detectAmount(row,d);if(amt.amount<=0)continue;
    if(!employee.id){if(unmatched.length<25)unmatched.push({date,type:kind.raw,amount:amt.amount,account:account.value,row:Object.fromEntries(Object.entries(row).slice(0,20))});continue}
    const current=date>=bounds.from&&date<=bounds.to,before=date<bounds.from;
    const target=kind.k==='REPAY'?(current?repaid:beforeRepaid):(current?spent:beforeSpent);
    if(current||before)target.set(employee.id,(target.get(employee.id)||0)+amt.amount);
    if(current&&matched.length<50)matched.push({date,employeeId:employee.id,employee:employee.value,type:kind.raw,class:kind.k,amount:amt.amount,typeField:kind.field,employeeField:employee.field,accountField:account.field,amountField:amt.field});
  }
  const t=now(),stmts=[];
  for(const e of list){
    const opening=money(Math.max(0,(beforeSpent.get(e.idKey)||0)-(beforeRepaid.get(e.idKey)||0))),used=money(spent.get(e.idKey)||0),paid=money(repaid.get(e.idKey)||0),closing=money(Math.max(0,opening+used-paid));
    const details={mode:'KRED_ROBUST_V3',spent:used,repaid:paid,openingDebt:opening,closingDebt:closing,rawKinds:Object.fromEntries(rawKinds),discovery:d,mealAccounts:accounts.matched,historyFrom:bounds.yearStart,syncedAt:t};
    stmts.push(env.DB.prepare(`INSERT INTO hr_employee_meal_monthly(user_id,iiko_employee_id,month,opening_debt,closing_debt,month_net_increase,source,synced_at,details_json) VALUES(?1,?2,?3,?4,?5,?6,'IIKO_MEAL_TRANSACTIONS_V3',?7,?8) ON CONFLICT(user_id,iiko_employee_id,month) DO UPDATE SET opening_debt=excluded.opening_debt,closing_debt=excluded.closing_debt,month_net_increase=excluded.month_net_increase,source=excluded.source,synced_at=excluded.synced_at,details_json=excluded.details_json`).bind(userId,e.id,month,opening,closing,used,t,JSON.stringify(details)));
  }
  for(let i=0;i<stmts.length;i+=50)await env.DB.batch(stmts.slice(i,i+50));
  return{matchedTransactions:matched.length,totalRows:tx.rows.length,accountRows,kredRows,rawKinds:Object.fromEntries(rawKinds),matchedSample:matched,unmatched,fields:d,mealAccounts:accounts.matched,request:tx.request};
}

async function records(db,userId,month){
  const r=await db.prepare(`SELECT iiko_employee_id,opening_debt,closing_debt,month_net_increase,source,synced_at,details_json FROM hr_employee_meal_monthly WHERE user_id=?1 AND month=?2`).bind(userId,month).all();
  return(r.results||[]).map(x=>{let d={};try{d=JSON.parse(x.details_json||'{}')}catch(_){d={}}return{employeeId:x.iiko_employee_id,openingDebt:money(x.opening_debt),closingDebt:money(x.closing_debt),spent:money(d.spent??x.month_net_increase),repaid:money(d.repaid??0),source:x.source||'',syncedAt:x.synced_at||'',details:d}})
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const url=new URL(request.url),month=monthOnly(url.searchParams.get('month'));if(!month)return json({success:false,message:'Укажите месяц YYYY-MM'},400);return json({success:true,month,records:await records(env.DB,state.user.id,month)})}catch(e){console.error('[HR-MEAL-V2-GET]',e);return json({success:false,message:e?.message||String(e)},500)}}
export async function onRequestPost({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const b=await request.json().catch(()=>({})),month=monthOnly(b.month),action=clean(b.action);if(!month)return json({success:false,message:'Укажите месяц YYYY-MM'},400);if(action!=='sync')return json({success:false,message:'Неизвестное действие'},400);const diagnostics=await sync(request,env,state.user.id,month);return json({success:true,month,records:await records(env.DB,state.user.id,month),diagnostics})}catch(e){console.error('[HR-MEAL-V2-POST]',e);return json({success:false,message:e?.message||String(e)},500)}}