// Safe, side-effect-free internal shipment cost preview.
// Not a document, not a permission to perform an iiko POST.
import {prepareInternalShipment} from "./internal-shipment-core.js";
const fail=(code,message)=>({valid:false,readOnly:true,canDispatch:false,code,message});
export function buildInternalDispatchPreview({status,route,approved,existing,requested,costQuotes,documentDate}={}){
  if(status!=="READY")return fail("ORDER_NOT_READY","Заявка ещё не готова к отгрузке.");
  if(!route?.valid)return fail("ROUTE_NOT_VERIFIED","Не подтверждены склады и внутренние контрагенты.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(documentDate||"")))
    return fail("INVALID_DOCUMENT_DATE","Не указана дата предполагаемой отгрузки.");
  // Never authorize a duplicate while the state of any previous attempt is unresolved.
  if((existing||[]).some(x=>["CHECK_REQUIRED","PROCESSING","IMPORTING"].includes(x.status)))
    return fail("PREVIOUS_SHIPMENT_UNCERTAIN","По этой заявке есть неподтверждённая попытка отгрузки. До сверки прежнего документа новая отправка запрещена.");
  let prepared;
  try{prepared=prepareInternalShipment(approved,existing,requested,costQuotes);}
  catch(e){return fail("COST_OR_QUANTITY_INVALID",String(e?.message||e));}
  return {valid:true,readOnly:true,canDispatch:false,stockOperation:false,
    documentDate,sourceStoreId:route.outgoing.defaultStoreId,
    recipientStoreId:route.expectedIncoming.recipientStoreId,
    buyerId:route.outgoing.counteragentId,buyerName:route.outgoing.counteragentName,
    senderSupplierId:route.expectedIncoming.supplierId,
    senderSupplierName:route.expectedIncoming.supplierName,
    quantityLines:prepared.lines.map(l=>({productId:l.productId,productName:l.productName,
      unit:l.unit,quantity:l.amount,unitCost:l.unitPrice,valueAZN:l.sumCents/100,
      costSource:l.costSource,costTimestamp:l.costTimestamp})),
    totalAZN:prepared.totalCents/100,
    code:"READ_ONLY_DISPATCH_PREVIEW",
    message:"План отгрузки рассчитан по себестоимости склада отправителя. Это только предварительный расчёт. Реальная отгрузка заблокирована до отдельного подтверждения механизма iikoChain и согласия на тест."};
}
