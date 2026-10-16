import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { mobilePeriod, clean, safeNumber } from "../_lib/query-helpers.js";
import { getOlapFields, iikoJson } from "../../iiko/_lib/iiko-client.js";
import { getCurrentOperatingShifts, resolveOlapCashShiftField, operatingToday } from "../../iiko/_lib/operational-day.js";

const FIELDSETS = {
  sales: { group: ["OpenDate.Typed","OpenDate"], measures: ["DishDiscountSumInt","DishSumInt"] },
  cash: { group: ["CashRegisterName","CashRegister.Name","CashRegister","CashDeskName","TerminalName"], secondary: ["PayTypes","PayType","PaymentType.Name","PaymentType","PayType.Name","PaymentMethod.Name","PaymentMethod","TenderType","PaymentTypeName","PayTypeName"], measures: ["DishDiscountSumInt","DishSumInt"] },
  dishes: { group: ["DishName","Dish.Name","DishFullName","Dish"], measures: ["DishDiscountSumInt","DishSumInt"] },
  categories: { group: ["DishCategory","DishCategory.Name","DishCategoryName","CategoryName"], measures: ["DishDiscountSumInt","DishSumInt"] },
  discounts: { group: [
    "DiscountName","Discount.Name","DiscountCardType.Name",
    "DiscountCardType","DiscountType.Name","DiscountType",
    "DiscountCard.Name","DiscountCardTypeName"
  ], measures: [
    "DiscountSum","DiscountSumInt","DiscountAmount","DiscountAmountInt",
    "DiscountSumWithoutTax","DiscountAmountWithoutTax"
  ] },
  surcharges: { group: ["IncreaseName","Increase.Name","IncreaseType.Name","SurchargeName","Surcharge.Name","ExtraCharge.Name","IncreaseType","Increase","SurchargeType"], measures: ["IncreaseSumInt","IncreaseSum","IncreaseAmountInt","IncreaseAmount","SurchargeSumInt","SurchargeSum","ExtraChargeSum","ExtraChargeAmount"] },
  foodCost: { group: [
    "DishName","Dish.Name","DishFullName","Dish",
    "DishCategory","DishCategory.Name","DishCategoryName"
  ], measures: [
    "ProductCostBase.Cost","ProductCostBase.Sum","ProductCostBase.CostSum",
    "ProductCostBase.CostAmount","ProductCostBase.IngredientCost",
    "Себестоимость", "Себестоимость блюд", "Себестоимость без НДС"
  ] }
};
const norm = v => clean(v).toLowerCase().replace(/[\s._()-]+/g,"");
// Match the exact technical field first, then the documented display title.
// Never substitute a different financial measure because the name "looks
// close" (e.g. net sales instead of discount amount).
export const findOlapField = (fields, candidates) => {
  for (const c of candidates) {
    const v = fields.find(f => norm(f.name) === norm(c));
    if (v) return v.name;
  }
  for (const c of candidates) {
    const v = fields.find(f => norm(f.title) === norm(c));
    if (v) return v.name;
  }
  return null;
};
export const findOlapGroupField = (fields,candidates) => {
  for(const candidate of candidates){
    const field=findOlapField(fields,[candidate]);
    if(field&&fields.find(f=>f.name===field)?.groupingAllowed!==false)return field;
  }
  return null;
};
export const findOlapMeasureField = (fields,candidates) => {
  for(const candidate of candidates){
    const field=findOlapField(fields,[candidate]);
    if(field&&fields.find(f=>f.name===field)?.aggregationAllowed!==false)return field;
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
      label: secondaryField ? (secondary || "Не указан") : group, group,
      value: safeNumber(value(row, measureField, fields))
    };
  }).filter(row=>row.value!==null);
  return {
    success: true, kind, currency: "AZN", selectedDepartmentIds: selectedIds,
    groupField, secondaryField, measureField, count: normalized.length,
    totalValue: normalized.reduce((sum, row) => sum + row.value, 0),
    rows: normalized.slice(0,500), truncated: normalized.length>500,
    source:"SH OLAP SALES"
  };
}

// Keep report period/filter semantics testable without live credentials.
export function buildMobileReportFilters({from,to,departmentField,selectedIds,
  operating=null,shiftField=null}) {
  if(!departmentField || !Array.isArray(selectedIds) || !selectedIds.length)
    throw new MobileError("OLAP_SCOPE_UNAVAILABLE",
      "Не подтверждены рестораны мобильного отчёта.",409);
  if(operating && (!shiftField || !Array.isArray(operating.shiftIds) ||
      !operating.shiftIds.length)) throw new MobileError(
      "OLAP_SHIFT_FIELD_UNAVAILABLE",
      "SH OLAP не позволяет подтвердить кассовые смены.",409);
  const result={
    "OpenDate.Typed":{filterType:"DateRange",periodType:"CUSTOM",
      from:operating?.from||from,to:operating?.to||to,
      includeLow:true,includeHigh:true},
    [departmentField]:{filterType:"IncludeValues",values:[...new Set(selectedIds)]},
    DeletedWithWriteoff:{filterType:"IncludeValues",values:["NOT_DELETED"]},
    OrderDeleted:{filterType:"IncludeValues",values:["NOT_DELETED"]}
  };
  if(operating) result[shiftField]={
    filterType:"IncludeValues",values:operating.shiftIds
  };
  return result;
}

export async function onRequestGet({request,env}) {
  try {
    const kind=clean(new URL(request.url).searchParams.get("kind")||"sales");
    const spec=FIELDSETS[kind];
    if(!spec) throw new MobileError("UNKNOWN_REPORT", "Неизвестный мобильный отчёт.",400);
    const {from,to}=mobilePeriod(request,32);
    const mode=clean(new URL(request.url).searchParams.get("mode"))==="operational"?"operational":"calendar";
    if(mode==="operational"&&(from!==to||to!==operatingToday()))
      throw new MobileError("OPERATING_DATE_INVALID",
        "Операционный день доступен только для периода «Сегодня».",400);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    const meta=await getOlapFields(ctx.connection,"SALES");
    const fields=meta.fields||[];
    const group=findOlapGroupField(fields,spec.group);
    const secondary=spec.secondary ? findOlapGroupField(fields,spec.secondary) : null;
    const measure=findOlapMeasureField(fields,spec.measures);
    const dep=findOlapField(fields,["Department.Id","DepartmentId","Department.ID"]);
    if (kind !== "discounts" && (!group || !measure)) throw new MobileError("REPORT_FIELDS_UNAVAILABLE",
      kind === "discounts"
        ? "На этом SH Server не найдены отдельные OLAP-поля типа скидки или суммы скидки. Такой отчёт нельзя заменить суммой продаж."
        : kind === "foodCost"
        ? "SH OLAP не передал поле себестоимости. Продажи нельзя выдавать за себестоимость."
        : "В SH OLAP отсутствуют поля для выбранного отчёта.",409);
    if (kind === "cash" && !secondary) throw new MobileError("PAYMENT_FIELDS_UNAVAILABLE",
      "SH OLAP не передал поле типа оплаты. Отчёт по кассам без разбивки по способам оплаты не будет показан.",409);
    if (!dep) throw new MobileError("OLAP_SCOPE_UNAVAILABLE",
      "SH OLAP не позволяет ограничить отчёт выбранными ресторанами.",409);
    let operating=null, effectiveFrom=from, effectiveTo=to;
    let shiftField=null;
    if(mode==="operational"){
      operating=await getCurrentOperatingShifts(ctx.connection,ctx.selectedIds);
      shiftField=resolveOlapCashShiftField(fields);
      if(!shiftField)throw new MobileError("OLAP_SHIFT_FIELD_UNAVAILABLE",
        "SH OLAP не предоставляет идентификатор кассовой смены для точного отчёта.",409);
      effectiveFrom=operating.from;
      effectiveTo=operating.to;
    }
    const filters=buildMobileReportFilters({from,to,departmentField:dep,
      selectedIds:ctx.selectedIds,operating,shiftField});
    if(kind==="discounts"){
      const runAmount=async(set,reportKind)=>{
        const amountField=findOlapMeasureField(fields,set.measures);
        const typeField=findOlapGroupField(fields,set.group);
        const groupField=typeField||dep;
        if(!amountField||!groupField)return {
          available:false,rows:[],totalValue:null,
          reason:reportKind==="discounts"
            ?"SH OLAP не передал отдельное поле суммы скидки."
            :"SH OLAP не передал отдельное поле суммы надбавки.",
          byRestaurant:false
        };
        const requestBody={reportType:"SALES",buildSummary:true,
          groupByRowFields:[groupField],groupByColFields:[],
          aggregateFields:[amountField],filters};
        const source=await iikoJson(ctx.connection,"/resto/api/v2/reports/olap",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify(requestBody),timeoutMs:60000});
        if(!source.ok||source.payload?.success===false||
          source.payload?.error===true||source.payload?.errorCode||
          source.payload?.errorMessage||
          !(Array.isArray(source.payload?.data)||Array.isArray(source.payload)))
          return {available:false,rows:[],totalValue:null,
            reason:"SH OLAP не вернул данные для этой части отчёта.",
            byRestaurant:!typeField};
        const mapped=mobileOlapRows(source.payload,groupField,amountField,
          fields,ctx.selectedIds,reportKind);
        return {...mapped,available:true,byRestaurant:!typeField,
          groupField,measureField:amountField};
      };
      const [discounts,surcharges]=await Promise.all([
        runAmount(FIELDSETS.discounts,"discounts"),
        runAmount(FIELDSETS.surcharges,"surcharges")
      ]);
      if(!discounts.available&&!surcharges.available)
        throw new MobileError("REPORT_FIELDS_UNAVAILABLE",
          "На этом SH Server не найдены подтверждённые поля скидок и надбавок. Продажи нельзя подставлять вместо этих сумм.",409);
      return response({
        success:true,kind:"discounts",currency:"AZN",
        discounts:discounts.rows||[],surcharges:surcharges.rows||[],
        discountTotal:discounts.available?discounts.totalValue:null,
        surchargeTotal:surcharges.available?surcharges.totalValue:null,
        discountAvailable:discounts.available,
        surchargeAvailable:surcharges.available,
        discountByRestaurant:discounts.byRestaurant===true,
        surchargeByRestaurant:surcharges.byRestaurant===true,
        discountUnavailableReason:discounts.available?null:discounts.reason,
        surchargeUnavailableReason:surcharges.available?null:surcharges.reason,
        partial:!discounts.available||!surcharges.available,
        from:effectiveFrom,to:effectiveTo,mode,
        operatingDay:operating?{from:operating.from,to:operating.to,
          activeShiftCount:operating.activeShiftCount,
          shiftCount:operating.shiftCount}:null,
        selectedDepartmentIds:ctx.selectedIds,
        source:"SH OLAP SALES",updatedAt:new Date().toISOString()
      });
    }
    const olapRequest={reportType:"SALES",buildSummary:true,
      groupByRowFields:secondary ? [group, secondary] : [group],groupByColFields:[],
      aggregateFields:[measure],filters};
    const upstream=await iikoJson(ctx.connection,"/resto/api/v2/reports/olap",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(olapRequest),timeoutMs:60000});
    if(!upstream.ok || upstream.payload?.success===false ||
       upstream.payload?.error===true || upstream.payload?.errorCode ||
       upstream.payload?.errorMessage) throw new MobileError("REPORT_SOURCE_FAILED",
      "SH OLAP не вернул выбранный отчёт.",502);
    return response({
      ...mobileOlapRows(upstream.payload,group,measure,fields,ctx.selectedIds,kind,secondary),
      from:effectiveFrom,to:effectiveTo,mode,
      operatingDay:operating ? {from:operating.from,to:operating.to,
        activeShiftCount:operating.activeShiftCount,
        shiftCount:operating.shiftCount} : null,
      updatedAt:new Date().toISOString()
    });
  }catch(error){return errorResponse(error);}
}
