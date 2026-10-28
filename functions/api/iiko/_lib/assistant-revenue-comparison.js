import { getOlapFields, iikoJson } from "./iiko-client.js";
const isIikoLicenseSeatExhausted = value => /License enhancement is required|no connections available for module REST_API|REST_API\(2000\)/i.test(String(value||""));

const clean = v => String(v ?? "").trim();
const unique = xs => [...new Set((xs || []).map(clean).filter(Boolean))];
const norm = v => clean(v).toLowerCase().replace(/[\s._()-]+/g, "");
const dateValid = s => /^\d{4}-\d{2}-\d{2}$/.test(clean(s)) &&
  !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0,10) === s;

function field(fields, names, role) {
  for (const name of names) {
    const item = (fields || []).find(f => norm(f.name) === norm(name));
    if (!item) continue;
    if (role === "group" && item.groupingAllowed === false) continue;
    if (role === "measure" && item.aggregationAllowed === false) continue;
    return item;
  }
  return null;
}

export function planRevenueComparison(fields, scope, from, to) {
  const ids=unique(scope?.selectedDepartmentIds);
  const allowed=new Set(unique(scope?.allowedDepartmentIds));
  if (!scope?.mobileStrict || !ids.length || ids.some(id=>!allowed.has(id))) {
    return {success:false,code:"AI_REVENUE_SCOPE_NOT_VERIFIED",
      message:"Не удалось подтвердить выбранные и разрешённые рестораны."};
  }
  if (!dateValid(from) || !dateValid(to) || from>to)
    return {success:false,code:"AI_REVENUE_PERIOD_INVALID",
      message:"Период должен быть корректным диапазоном дат YYYY-MM-DD."};

  const department=field(fields,["Department.Id","DepartmentId","Department.ID"],"group");
  const date=field(fields,["OpenDate.Typed","OpenDate"],"group");
  const revenue=field(fields,["DishDiscountSumInt","DishSumInt"],"measure");
  if (!department || !date || !revenue) {
    return {success:false,code:"AI_REVENUE_FIELDS_UNAVAILABLE",
      message:"OLAP не подтвердил идентификатор ресторана, дату и поле выручки.",
      missing:{department:!department,date:!date,revenue:!revenue}};
  }
  const optional=field(fields,["OrderDeleted"],"filter");
  const deleted=field(fields,["DeletedWithWriteoff"],"filter");
  const filters={
    [date.name]:{filterType:"DateRange",periodType:"CUSTOM",
      from,to,includeLow:true,includeHigh:true},
    [department.name]:{filterType:"IncludeValues",values:ids}
  };
  if(optional)filters[optional.name]={filterType:"IncludeValues",values:["NOT_DELETED"]};
  if(deleted)filters[deleted.name]={filterType:"IncludeValues",values:["NOT_DELETED"]};
  return {success:true,ids,department,date,revenue,filters,from,to};
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const str=clean(value).replace(/\s/g,"");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(str))return null;
  const n=Number(str.replace(",","."));
  return Number.isFinite(n)?n:null;
}

const rowValue=(row, metadata, fields) => {
  if(Object.hasOwn(row,metadata.name))return row[metadata.name];
  const title=clean(metadata.title);
  if(title && fields.some(f=>f.name===metadata.name && f.title===title) &&
    Object.hasOwn(row,title))return row[title];
  return undefined;
};

function parsedDate(raw) {
  const s=clean(raw);
  if (dateValid(s.slice(0,10))) return s.slice(0,10);
  const match=/^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  if(match) {
    const d=`${match[3]}-${match[2]}-${match[1]}`;
    if(dateValid(d))return d;
  }
  return null;
}

export function summarizeVerifiedRevenue(payload, plan, fields, names = []) {
  const records=Array.isArray(payload?.data)?payload.data
    :Array.isArray(payload)?payload:null;
  if(!records) return {success:false,code:"AI_REVENUE_INVALID_RESPONSE",
    message:"SH OLAP вернул неподдерживаемый формат выручки."};
  if(records.length>10000)return {success:false,code:"AI_REVENUE_TOO_MANY_ROWS",
    message:"Ответ OLAP слишком большой для точного суммирования."};
  if(!records.length)return {success:false,code:"AI_REVENUE_NO_ROWS",
    message:"За выбранный период OLAP не вернул строк. Это не доказывает отсутствие продаж."};
  const allowed=new Set(plan.ids),totals=new Map(),daily=new Map();
  const directory=new Map((names||[]).map(x=>[clean(x.id),clean(x.name)]));
  for(const row of records){
    if(!row||typeof row!=="object"||Array.isArray(row))
      return {success:false,code:"AI_REVENUE_INVALID_ROW",message:"OLAP вернул некорректную строку."};
    const id=clean(rowValue(row,plan.department,fields));
    if(!id||!allowed.has(id))
      return {success:false,code:"AI_REVENUE_DEPARTMENT_MISMATCH",
        message:"Строка OLAP не подтверждена выбранным рестораном. Отчёт заблокирован."};
    const date=parsedDate(rowValue(row,plan.date,fields));
    if(!date||date<plan.from||date>plan.to)
      return {success:false,code:"AI_REVENUE_DATE_MISMATCH",
        message:"Дата в строке OLAP вне запрошенного периода."};
    const amount=numeric(rowValue(row,plan.revenue,fields));
    if(amount===null)return {success:false,code:"AI_REVENUE_AMOUNT_MISSING",
      message:"OLAP вернул строки без проверяемых числовых значений выручки."};
    totals.set(id,(totals.get(id)||0)+amount);
    const dayKey=id+"|"+date;
    daily.set(dayKey,(daily.get(dayKey)||0)+amount);
  }
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  const rows=[...totals].map(([id,sum])=>({
    departmentId:id,departmentName:directory.get(id)||id,revenue:round(sum)
  })).sort((a,b)=>b.revenue-a.revenue || a.departmentName.localeCompare(b.departmentName,"ru"));
  const missing=plan.ids.filter(id=>!totals.has(id)).map(id=>({
    departmentId:id,departmentName:directory.get(id)||id
  }));
  const days=[...daily].map(([key,value])=>{
    const [id,date]=key.split("|");
    return {departmentId:id,date,revenue:round(value)};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.departmentId.localeCompare(b.departmentId));
  return {
    success:true,kind:"verified_revenue_comparison",
    source:"SH OLAP SALES",currency:"AZN",
    period:{from:plan.from,to:plan.to},
    sourceRows:records.length,revenueField:plan.revenue.name,
    selectedRestaurantCount:plan.ids.length,restaurantsWithRows:rows.length,
    totalRevenue:round(rows.reduce((sum,r)=>sum+r.revenue,0)),
    rows,days,restaurantsWithoutRows:missing,
    warning:missing.length
      ?"По части выбранных подразделений OLAP не вернул строк. Это не следует трактовать как нулевую выручку."
      :null
  };
}

export async function getVerifiedRevenueComparison(connection,scope,from,to) {
  // Authorize and verify without touching an external API first.
  const pre=planRevenueComparison([],scope,from,to);
  if(!pre.success && pre.code!=="AI_REVENUE_FIELDS_UNAVAILABLE")return pre;
  const metadata=await getOlapFields(connection,"SALES");
  const fields=metadata.fields||[];
  const plan=planRevenueComparison(fields,scope,from,to);
  if(!plan.success)return plan;
  const request={
    reportType:"SALES",buildSummary:true,
    groupByRowFields:[plan.department.name,plan.date.name],
    groupByColFields:[],aggregateFields:[plan.revenue.name],filters:plan.filters
  };
  const result=await iikoJson(connection,"/resto/api/v2/reports/olap",{
    method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify(request),timeoutMs:60000
  });
  if(!result.ok||result.payload?.success===false||result.payload?.error===true||
      result.payload?.errorCode||result.payload?.errorMessage) {
    const noSeat=isIikoLicenseSeatExhausted(result.text);
    return {success:false,status:result.status,
      code:noSeat?"REST_API_LICENSE_EXHAUSTED":"AI_REVENUE_OLAP_ERROR",
      message:noSeat?"SH Server не выделил подключение REST API.":
        "SH OLAP не вернул успешный ответ по выручке (HTTP "+result.status+")."};
  }
  return summarizeVerifiedRevenue(result.payload,plan,fields,scope?.selectedRestaurants);
}
