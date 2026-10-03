import { clean, iikoJson, getOlapFields } from "./_lib/iiko-client.js";

function corsHeaders(){return{
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
};}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
function norm(v){return clean(v).toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/g," ").trim();}
function asArray(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["data","items","rows","records","result"]){
    if(Array.isArray(payload?.[k]))return payload[k];
  }
  return [];
}
function fieldKey(field){return clean(field?.name);}
function fieldText(field){return norm([field?.title,field?.name].filter(Boolean).join(" "));}
function scoreField(field,include=[],exclude=[]){
  const text=fieldText(field);
  if(exclude.some(x=>text.includes(norm(x))))return -1;
  let score=0;
  for(const token of include){
    const n=norm(token);
    if(!n)continue;
    if(text===n)score+=10;
    else if(text.includes(n))score+=4;
  }
  return score;
}
function pickField(fields,include,exclude=[],predicate=null){
  let best=null,bestScore=0;
  for(const field of fields||[]){
    if(predicate&&!predicate(field))continue;
    const score=scoreField(field,include,exclude);
    if(score>bestScore){best=field;bestScore=score;}
  }
  return best;
}
function canGroup(field){return field&&field.groupingAllowed!==false&&!field.isMeasure}
function canAggregate(field){return field&&(field.aggregationAllowed===true||field.isMeasure===true||field.source==="measures")}
function isAccountTypeGroupField(field){
  const text=fieldText(field).replace(/\s+/g,"");
  return [
    "accounttypegroup","accountgroup","typegroup","счетагруппа","группасчета",
    "типсчета","accounttype","correspondentaccounttypegroup","corraccounttypegroup"
  ].some(x=>text.includes(norm(x).replace(/\s+/g,"")));
}
function isRealAccountDimension(field){
  return canGroup(field)&&!isAccountTypeGroupField(field);
}
function sideKind(value){
  const v=norm(value);
  if(!v)return"";
  if(["debit","дебет","приход","income","in","plus","positive"].some(x=>v===x||v.includes(x)))return"debit";
  if(["credit","кредит","расход","expense","out","minus","negative"].some(x=>v===x||v.includes(x)))return"credit";
  return"";
}
function rowValue(row,field){
  const key=fieldKey(field);if(!key||!row||typeof row!=="object")return null;
  if(Object.prototype.hasOwnProperty.call(row,key))return row[key];
  const wanted=key.toLowerCase();
  const found=Object.keys(row).find(k=>String(k).toLowerCase()===wanted);
  return found?row[found]:null;
}
function numberValue(value){
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function dateOnly(value){
  const s=clean(value);
  const m=s.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:s.slice(0,10);
}
function daysBetween(from,to){
  const a=new Date(from+"T00:00:00Z"),b=new Date(to+"T00:00:00Z");
  return Math.floor((b-a)/86400000)+1;
}
function accountTextMatches(value,accountName,accountCode){
  const v=norm(value),n=norm(accountName),c=norm(accountCode);
  if(!v)return false;
  if(n&&(v===n||v.includes(n)||n.includes(v)))return true;
  if(c&&(v===c||v.startsWith(c+" ")||v.includes(" "+c+" ")||v.endsWith(" "+c)))return true;
  return false;
}
function uniquePostings(rows){
  const seen=new Set(),out=[];
  for(const row of rows){
    const key=[
      row.date,row.number,row.type,row.account,row.correspondentAccount,row.correspondentCounteragent,
      row.comment,row.department,row.debit,row.credit,row.balance
    ].map(x=>String(x??"")).join("|");
    if(seen.has(key))continue;
    seen.add(key);out.push(row);
  }
  return out;
}
function selectedDepartmentFilter(fields,body){
  const ids=Array.isArray(body.departmentIds)?body.departmentIds.map(clean).filter(Boolean):[];
  const names=Array.isArray(body?.chainScope?.selectedDepartmentNames)?body.chainScope.selectedDepartmentNames.map(clean).filter(Boolean):[];
  const allowed=Array.isArray(body?.chainScope?.allowedDepartmentIds)?body.chainScope.allowedDepartmentIds.map(clean).filter(Boolean):[];
  const subset=String(body?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&allowed.length>ids.length&&ids.length>0;
  if(!subset)return null;

  const departmentIdField=pickField(fields,["department id","departmentid","подразделение id","id подразделения"],["corr","корр"]);
  if(departmentIdField&&ids.length)return{field:departmentIdField,values:ids,source:"department-id"};

  const departmentField=pickField(fields,["подразделение","department","restaurant","организация"],["corr","корр","legal","юр лицо"]);
  if(departmentField&&names.length)return{field:departmentField,values:names,source:"department-name"};

  const error=new Error("SH Server не предоставил поле подразделения, пригодное для безопасной фильтрации проводок выбранного ресторана.");
  error.status=409;
  error.code="ACCOUNT_POSTINGS_SCOPE_UNAVAILABLE";
  throw error;
}
function normalizePosting(row,fields,matchedOn="account"){
  const debitRaw=numberValue(rowValue(row,fields.debit));
  const creditRaw=numberValue(rowValue(row,fields.credit));
  const signed=numberValue(rowValue(row,fields.amount));
  const side=sideKind(rowValue(row,fields.transactionSide));
  let debit=debitRaw!==null?Math.abs(debitRaw):0;
  let credit=creditRaw!==null?Math.abs(creditRaw):0;
  if(debitRaw===null&&creditRaw===null&&signed!==null){
    if(side==="debit")debit=Math.abs(signed);
    else if(side==="credit")credit=Math.abs(signed);
    else if(signed>0)debit=signed;
    else if(signed<0)credit=Math.abs(signed);
  }
  const balance=numberValue(rowValue(row,fields.balance));
  const mainAccount=clean(rowValue(row,fields.account));
  const corrAccount=clean(rowValue(row,fields.correspondentAccount));
  if(matchedOn==="correspondent"){
    return{
      date:dateOnly(rowValue(row,fields.date)),
      number:clean(rowValue(row,fields.number)),
      type:clean(rowValue(row,fields.type)),
      account:corrAccount,
      correspondentAccount:mainAccount,
      correspondentCounteragent:clean(rowValue(row,fields.correspondentCounteragent)),
      comment:clean(rowValue(row,fields.comment)),
      department:clean(rowValue(row,fields.department)),
      legalEntity:clean(rowValue(row,fields.legalEntity)),
      concept:clean(rowValue(row,fields.concept)),
      transactionSide:clean(rowValue(row,fields.transactionSide)),
      debit:credit,
      credit:debit,
      amount:signed!==null?-signed:credit-debit,
      balance
    };
  }
  return{
    date:dateOnly(rowValue(row,fields.date)),
    number:clean(rowValue(row,fields.number)),
    type:clean(rowValue(row,fields.type)),
    account:mainAccount,
    correspondentAccount:corrAccount,
    correspondentCounteragent:clean(rowValue(row,fields.correspondentCounteragent)),
    comment:clean(rowValue(row,fields.comment)),
    department:clean(rowValue(row,fields.department)),
    legalEntity:clean(rowValue(row,fields.legalEntity)),
    concept:clean(rowValue(row,fields.concept)),
    transactionSide:clean(rowValue(row,fields.transactionSide)),
    debit,
    credit,
    amount:signed!==null?signed:debit-credit,
    balance
  };
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}

export async function onRequestPost({request}){
  try{
    const body=await request.json();
    const connection={ip:clean(body.ip),port:clean(body.port),login:clean(body.login),password:String(body.password||"")};
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return json({success:false,message:"Нет подключения к SH Server"},400);
    const from=dateOnly(body.from),to=dateOnly(body.to),accountId=clean(body.accountId),accountCode=clean(body.accountCode),accountName=clean(body.accountName);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({success:false,message:"Укажите корректный период"},400);
    if(!accountId&&!accountName)return json({success:false,message:"Не выбран счёт"},400);

    const metadata=await getOlapFields(connection,"TRANSACTIONS");
    const allFields=metadata.fields||[];
    const fields={
      date:pickField(allFields,["дата","date","transaction date","transactiondate"],[],canGroup),
      number:pickField(allFields,["номер","number","transaction number","transactionnumber"],["account","счет"],canGroup),
      type:pickField(allFields,["тип","type","transaction type","transactiontype"],["account","счет"],canGroup),
      account:pickField(allFields,["счет","account"],["корр","corr","group","группа","type","тип"],isRealAccountDimension),
      accountId:pickField(allFields,["account id","accountid","id счета","id счет"],["corr","корр","group","группа","type","тип"],f=>f.filteringAllowed!==false&&!isAccountTypeGroupField(f)),
      correspondentAccount:pickField(
        allFields,
        ["корр счет","коррсчет","correspondent account","corr account","correspondentaccount"],
        ["group","группа","type","тип"],
        isRealAccountDimension
      ),
      correspondentCounteragent:pickField(allFields,["корр контрагент","correspondent counteragent","corr counteragent"],[],canGroup),
      comment:pickField(allFields,["комментарий","comment","description"],[],canGroup),
      department:pickField(allFields,["подразделение","department","restaurant"],["corr","корр","legal","юр лицо","id"],canGroup),
      legalEntity:pickField(allFields,["юр лицо","юридическое лицо","legal entity","legalentity"],[],canGroup),
      concept:pickField(allFields,["концепция","concept"],[],canGroup),
      transactionSide:pickField(allFields,["transaction side","transactionside","сторона проводки","дебет кредит","debit credit"],[],canGroup),
      debit:pickField(allFields,["сумма прихода","debit amount","debitsum","debit sum","income amount","incoming amount"],[],canAggregate),
      credit:pickField(allFields,["сумма расхода","credit amount","creditsum","credit sum","expense amount","outgoing amount"],[],canAggregate),
      amount:pickField(allFields,["transaction sum","transactionsum","transaction amount","transactionamount","сумма проводки","amount","sum"],["итог","total","balance","остаток"],canAggregate),
      balance:pickField(allFields,["остаток","balance","saldo","сальдо"],[],canAggregate)
    };

    if(!fields.date||!fields.account||(!fields.debit&&!fields.credit&&!fields.amount)){
      return json({
        success:false,
        code:"TRANSACTION_FIELDS_UNAVAILABLE",
        message:"SH Server не вернул обязательные поля OLAP отчёта по проводкам.",
        meta:{
          found:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v?{name:v.name,title:v.title}:null])),
          available:allFields.slice(0,120)
        }
      },409);
    }

    const groupBy=[
      fields.date,fields.number,fields.type,fields.account,fields.correspondentAccount,
      fields.correspondentCounteragent,fields.comment,fields.department,fields.legalEntity,fields.concept,fields.transactionSide
    ].filter(Boolean).filter(canGroup).map(fieldKey);
    const aggregates=[fields.debit,fields.credit,fields.amount,fields.balance].filter(Boolean).filter(canAggregate).map(fieldKey);

    const baseFilters={};
    baseFilters[fieldKey(fields.date)]={filterType:"DateRange",periodType:"CUSTOM",from,to,includeLow:true,includeHigh:true};

    const depFilter=selectedDepartmentFilter(allFields,body);
    if(depFilter){
      baseFilters[fieldKey(depFilter.field)]={filterType:"IncludeValues",values:depFilter.values};
      if(!groupBy.includes(fieldKey(depFilter.field)))groupBy.push(fieldKey(depFilter.field));
    }

    const runOlap=async(extraFilters={},label="query")=>{
      const filters={...baseFilters,...extraFilters};
      const requestBody={
        reportType:"TRANSACTIONS",
        buildSummary:false,
        groupByRowFields:[...new Set(groupBy)],
        groupByColFields:[],
        aggregateFields:[...new Set(aggregates)],
        filters
      };
      try{
        const result=await iikoJson(connection,"/resto/api/v2/reports/olap",{
          method:"POST",
          headers:{"Content-Type":"application/json",Accept:"application/json"},
          body:JSON.stringify(requestBody),
          timeoutMs:45000
        });
        if(!result.ok||!result.payload){
          return{
            ok:false,label,request:requestBody,rows:[],
            error:`HTTP ${result.status}${result.text?` — ${result.text.slice(0,700)}`:""}`
          };
        }
        return{ok:true,label,request:requestBody,rows:asArray(result.payload)};
      }catch(error){
        return{ok:false,label,request:requestBody,rows:[],error:String(error?.message||error)};
      }
    };

    const displayValues=[accountName,accountCode&&accountName?`${accountCode} ${accountName}`:"",accountCode&&accountName?`${accountCode} · ${accountName}`:""]
      .map(clean).filter(Boolean);
    const attempts=[];
    let postings=[];
    const departmentIds=Array.isArray(body.departmentIds)?body.departmentIds.map(clean).filter(Boolean):[];
    const singleRestaurantBounded=departmentIds.length===1&&daysBetween(from,to)<=45;

    const recordAttempt=r=>{
      attempts.push({
        label:r.label,
        ok:r.ok===true,
        rows:r.rows?.length||0,
        error:r.ok?null:r.error||"SH OLAP error"
      });
      return r;
    };

    // 1. GUID/id filter is the most precise when this SH build supports it.
    if(fields.accountId&&accountId){
      const r=recordAttempt(await runOlap(
        {[fieldKey(fields.accountId)]:{filterType:"IncludeValues",values:[accountId]}},
        "account-id"
      ));
      if(r.ok)postings.push(...r.rows.map(row=>normalizePosting(row,fields,"account")));
    }

    // 2. For one selected restaurant, prefer a period+department scan over
    // version-specific account-name enum filters. This avoids false zeroes
    // and errors such as AccountTypeGroup enum conversion.
    if(!postings.length&&singleRestaurantBounded){
      const r=recordAttempt(await runOlap({},"single-restaurant-period-fallback"));
      if(r.ok){
        for(const row of r.rows){
          const main=clean(rowValue(row,fields.account));
          const corr=clean(rowValue(row,fields.correspondentAccount));
          if(accountTextMatches(main,accountName,accountCode))postings.push(normalizePosting(row,fields,"account"));
          else if(accountTextMatches(corr,accountName,accountCode))postings.push(normalizePosting(row,fields,"correspondent"));
        }
      }
    }

    // 3. For broader scopes try display-value filters, but a rejected probe
    // must never abort the whole ledger request.
    if(!postings.length&&!singleRestaurantBounded&&fields.account&&displayValues.length){
      const r=recordAttempt(await runOlap(
        {[fieldKey(fields.account)]:{filterType:"IncludeValues",values:displayValues}},
        "account-name"
      ));
      if(r.ok)postings.push(...r.rows.map(row=>normalizePosting(row,fields,"account")));
    }

    if(!postings.length&&!singleRestaurantBounded&&fields.correspondentAccount&&displayValues.length){
      const r=recordAttempt(await runOlap(
        {[fieldKey(fields.correspondentAccount)]:{filterType:"IncludeValues",values:displayValues}},
        "correspondent-account"
      ));
      if(r.ok)postings.push(...r.rows.map(row=>normalizePosting(row,fields,"correspondent")));
    }

    const successfulAttempt=attempts.some(x=>x.ok);
    if(!successfulAttempt&&attempts.length){
      const last=attempts[attempts.length-1];
      return json({
        success:false,
        code:"ACCOUNT_POSTINGS_OLAP_FAILED",
        message:`SH OLAP проводки: ${last.error||"запрос не выполнен"}`,
        meta:{attempts,accountMatch:{id:accountId,code:accountCode,name:accountName}}
      },502);
    }

    postings=uniquePostings(postings).filter(p=>{
      if(!accountName&&!accountCode)return true;
      return accountTextMatches(p.account,accountName,accountCode);
    });
    postings.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.number).localeCompare(String(b.number)));

    const totals=postings.reduce((a,x)=>{a.debit+=Number(x.debit||0);a.credit+=Number(x.credit||0);return a},{debit:0,credit:0});
    return json({
      success:true,
      account:{id:accountId,name:accountName},
      from,to,
      count:postings.length,
      postings,
      totals:{...totals,change:totals.debit-totals.credit},
      meta:{
        reportType:"TRANSACTIONS",
        olapFieldsCacheHit:metadata.cacheHit===true,
        departmentScope:depFilter?depFilter.source:"full-selection-or-rms",
        attempts,
        accountMatch:{id:accountId,code:accountCode,name:accountName},
        fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v?{name:v.name,title:v.title}:null]))
      }
    });
  }catch(error){
    return json({success:false,code:error?.code||undefined,message:error?.message||"Ошибка получения проводок"},Number(error?.status)||502);
  }
}
