import { getOlapFields, iikoJson, isIikoLicenseSeatExhausted } from "./iiko-client.js";

const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).toLowerCase().replace(/[\s._()-]+/g, "");
const findField = (fields, candidates, purpose) => {
  for (const candidate of candidates) {
    const item = fields.find(f => normalize(f.name) === normalize(candidate));
    if (item && (purpose !== "group" || item.groupingAllowed !== false) &&
        (purpose !== "measure" || item.aggregationAllowed !== false))
      return item.name;
  }
  return null;
};

export function planDishRankingFields(fields, departmentIds) {
  const ids = [...new Set((departmentIds || []).map(clean).filter(Boolean))];
  if (!ids.length) return {success:false,code:"AI_DISH_SCOPE_EMPTY",
    message:"Выбери хотя бы один разрешённый ресторан."};
  const department = findField(fields, ["Department.Id","DepartmentId","Department.ID"],"group");
  const dish = findField(fields, ["DishName","Dish.Name","DishFullName","Dish"],"group");
  const sales = findField(fields, ["DishDiscountSumInt","DishSumInt"],"measure");
  const quantity = findField(fields, ["DishAmountInt","DishAmount","DishCount"],"measure");
  if (!department || !dish || !sales) return {
    success:false,code:"AI_DISH_FIELDS_UNAVAILABLE",
    message:"OLAP не подтвердил поля ресторана, блюда или выручки.",
    missing:{department:!department,dish:!dish,sales:!sales}
  };
  return {success:true,ids,department,dish,sales,quantity};
}

const numeric = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text=clean(value).replace(/\s/g,"");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const out=Number(text.replace(",","."));
  return Number.isFinite(out) ? out : null;
};

export function summarizeDishRanking(payload, plan, requestedRange) {
  const records = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload) ? payload : null;
  if (!records) return {success:false,code:"AI_DISH_BAD_RESPONSE",
    message:"SH Server вернул неожиданный формат отчёта по блюдам."};
  const allowed = new Set(plan.ids);
  const totals = new Map();
  for (const row of records) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return {
      success:false,code:"AI_DISH_BAD_ROW",message:"OLAP вернул неверную строку отчёта."};
    // Require Department.Id *in each returned row* to prevent accidental
    // cross-restaurant data disclosure if an upstream filter is ignored.
    const departmentId = clean(row[plan.department]);
    if (!departmentId || !allowed.has(departmentId)) return {
      success:false,code:"AI_DISH_SCOPE_UNVERIFIED",
      message:"SH Server не подтвердил принадлежность строки отчёта выбранным ресторанам."};
    const name=clean(row[plan.dish]);
    const sales=numeric(row[plan.sales]);
    if (!name || sales === null) return {
      success:false,code:"AI_DISH_BAD_ROW",
      message:"Для одного из блюд OLAP не вернул проверяемое название или выручку."};
    const rawQty=plan.quantity ? numeric(row[plan.quantity]) : null;
    if (plan.quantity && rawQty === null) return {
      success:false,code:"AI_DISH_BAD_QUANTITY",
      message:"Для одного из блюд OLAP не вернул проверяемое количество."};
    const agg=totals.get(name)||{name,quantity:plan.quantity?0:null,revenue:0};
    agg.revenue+=sales;
    if (plan.quantity) agg.quantity+=rawQty;
    totals.set(name,agg);
  }
  const all=[...totals.values()];
  const byMetric = [...all].sort((a,b)=>{
    const x=plan.quantity?(b.quantity-a.quantity):(b.revenue-a.revenue);
    return x || b.revenue-a.revenue || a.name.localeCompare(b.name,"ru");
  });
  const bottom = [...all].sort((a,b)=>{
    const x=plan.quantity?(a.quantity-b.quantity):(a.revenue-b.revenue);
    return x || a.revenue-b.revenue || a.name.localeCompare(b.name,"ru");
  });
  const round = value => Math.round(value*100)/100;
  const concise = rows => rows.map(r=>({
    name:r.name,
    revenueAZN:round(r.revenue),
    ...(plan.quantity?{quantity:round(r.quantity)}:{})
  }));
  return {
    success:true,period:requestedRange,currency:"AZN",
    restaurants:plan.ids.length,rankingMetric:plan.quantity?"quantity":"revenue",
    revenueField:plan.sales,
    dishesAnalyzed:all.length,sourceRows:records.length,
    top:concise(byMetric.slice(0,10)),
    bottom:concise(bottom.slice(0,10)),
    warnings:[
      ...(plan.quantity?[]:["Поле количества блюд недоступно: рейтинг построен по выручке."]),
      "Решение об удалении блюда нельзя принимать без себестоимости, маржинальности и сезонности.",
      "Список охватывает только блюда, присутствующие в ответе OLAP; отсутствие строк не доказывает отсутствие блюда в меню."
    ]
  };
}

export async function readDishRankings(connection,scope,from,to) {
  const ids=Array.isArray(scope?.selectedDepartmentIds)
    ? scope.selectedDepartmentIds : [];
  const valid = text => /^\d{4}-\d{2}-\d{2}$/.test(clean(text)) &&
    !Number.isNaN(Date.parse(clean(text)+"T00:00:00Z"));
  if (!valid(from)||!valid(to)||from>to) return {
    success:false,code:"AI_DISH_PERIOD_INVALID",
    message:"Укажи корректный период отчёта YYYY-MM-DD."};
  if (!scope?.mobileStrict || !ids.length) return {
    success:false,code:"AI_DISH_SCOPE_UNVERIFIED",
    message:"Для отчёта по блюдам требуется подтверждённый выбор ресторанов."};
  const meta=await getOlapFields(connection,"SALES");
  const plan=planDishRankingFields(meta.fields||[],ids);
  if (!plan.success) return plan;
  if (!findField(meta.fields,["OpenDate.Typed"],"filter")) return {
    success:false,code:"AI_DISH_DATE_FIELD_UNAVAILABLE",
    message:"SH OLAP не подтвердил поле даты продаж."};
  const aggregateFields=[plan.sales,...(plan.quantity?[plan.quantity]:[])];
  const request={
    reportType:"SALES",buildSummary:true,
    groupByRowFields:[plan.department,plan.dish],groupByColFields:[],
    aggregateFields,
    filters:{
      "OpenDate.Typed":{
        filterType:"DateRange",periodType:"CUSTOM",
        from,to,includeLow:true,includeHigh:true
      },
      [plan.department]:{filterType:"IncludeValues",values:plan.ids}
    }
  };
  const result=await iikoJson(connection,"/resto/api/v2/reports/olap",{
    method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify(request),timeoutMs:60000
  });
  if (!result.ok) return {
    success:false,
    code:isIikoLicenseSeatExhausted(result.text)
      ?"REST_API_LICENSE_EXHAUSTED":"AI_DISH_OLAP_HTTP_ERROR",
    status:result.status,
    message:isIikoLicenseSeatExhausted(result.text)
      ?"Нет свободного подключения REST API у SH Server."
      : "SH Server отклонил OLAP отчёт по блюдам. HTTP "+result.status
  };
  return summarizeDishRanking(result.payload,plan,{from,to});
}
