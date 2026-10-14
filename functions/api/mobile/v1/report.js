import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { mobilePeriod, clean, safeNumber } from "../_lib/query-helpers.js";
import { getOlapFields, iikoJson } from "../../iiko/_lib/iiko-client.js";

const FIELDSETS = {
  sales: { group: ["OpenDate.Typed","OpenDate"], measures: ["DishDiscountSumInt","DishSumInt"] },
  cash: { group: ["CashRegisterName","CashRegister.Name","CashRegister","CashDeskName","TerminalName","CashierName","Cashier.Name"], secondary: ["DishName","Dish.Name","DishFullName","Dish"], measures: ["DishDiscountSumInt","DishSumInt"] },
  dishes: { group: ["DishName","Dish.Name","DishFullName","Dish"], measures: ["DishDiscountSumInt","DishSumInt"] },
  categories: { group: ["DishCategory","DishCategory.Name","DishCategoryName","CategoryName"], measures: ["DishDiscountSumInt","DishSumInt"] },
  discounts: { group: ["DiscountName","Discount.Name","DiscountCardType.Name"], measures: ["DiscountSum","DiscountSumInt","DiscountAmount"] },
  foodCost: { group: ["DishName","Dish.Name","DishCategory","DishCategory.Name"], measures: ["ProductCostBase.Cost","ProductCostBase.Sum","ProductCostBase.CostSum"] }
};
const norm = v => clean(v).toLowerCase().replace(/[\s._()-]+/g,"");
const find = (fields, candidates) => {
  for (const c of candidates) {
    const v = fields.find(f => norm(f.name)===norm(c));
    if (v) return v.name;
  }
  return null;
};
const value = (row, field, fields) => {
  const title = fields.find(f=>f.name===field)?.title;
  return row?.[field] ?? (title ? row?.[title] : null);
};

export function mobileOlapRows(payload, groupField, measureField, fields, selectedIds, kind, secondaryField = null) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : null;
  if (!rows) throw new MobileError("OLAP_BAD_RESPONSE", "Не удалось прочитать отчёт SH OLAP.", 502);
  const normalized = rows.map(row => {
    const group = clean(value(row, groupField, fields)) || "—";
    const secondary = secondaryField ? clean(value(row, secondaryField, fields)) : "";
    return {
      label: secondary || group, group,
      value: safeNumber(value(row, measureField, fields))
    };
  }).filter(row=>row.value!==null);
  return {
    success: true, kind, currency: "AZN", selectedDepartmentIds: selectedIds,
    groupField, secondaryField, measureField, count: normalized.length,
    rows: normalized.slice(0,500), truncated: normalized.length>500,
    source:"SH OLAP SALES"
  };
}

export async function onRequestGet({request,env}) {
  try {
    const kind=clean(new URL(request.url).searchParams.get("kind")||"sales");
    const spec=FIELDSETS[kind];
    if(!spec) throw new MobileError("UNKNOWN_REPORT", "Неизвестный мобильный отчёт.",400);
    const {from,to}=mobilePeriod(request,32);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    const meta=await getOlapFields(ctx.connection,"SALES");
    const fields=meta.fields||[];
    const group=find(fields,spec.group);
    const secondary=spec.secondary ? find(fields,spec.secondary) : null;
    const measure=find(fields,spec.measures);
    const dep=find(fields,["Department.Id","DepartmentId","Department.ID"]);
    if (!group || !measure) throw new MobileError("REPORT_FIELDS_UNAVAILABLE",
      "В SH OLAP отсутствуют поля для выбранного отчёта.",409);
    if (!dep) throw new MobileError("OLAP_SCOPE_UNAVAILABLE",
      "SH OLAP не позволяет ограничить отчёт выбранными ресторанами.",409);
    const filters={
      "OpenDate.Typed":{filterType:"DateRange",periodType:"CUSTOM",
        from,to,includeLow:true,includeHigh:true},
      [dep]:{filterType:"IncludeValues",values:ctx.selectedIds},
      DeletedWithWriteoff:{filterType:"IncludeValues",values:["NOT_DELETED"]},
      OrderDeleted:{filterType:"IncludeValues",values:["NOT_DELETED"]}
    };
    const olapRequest={reportType:"SALES",buildSummary:true,
      groupByRowFields:secondary ? [group, secondary] : [group],groupByColFields:[],
      aggregateFields:[measure],filters};
    const upstream=await iikoJson(ctx.connection,"/resto/api/v2/reports/olap",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(olapRequest),timeoutMs:60000});
    if(!upstream.ok) throw new MobileError("REPORT_SOURCE_FAILED",
      "SH OLAP не вернул выбранный отчёт.",502);
    return response({
      ...mobileOlapRows(upstream.payload,group,measure,fields,ctx.selectedIds,kind,secondary),
      from,to,updatedAt:new Date().toISOString()
    });
  }catch(error){return errorResponse(error);}
}
