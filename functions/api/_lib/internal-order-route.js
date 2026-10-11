// Scoped experimental cross-RMS outgoingInvoice import on the USER'S TEST CHAIN.
// This enables a single REST posting only from the dedicated PR preview and
// only for the exact mapped, known-good 50001 -> 10001 warehouse relationship.
// If the resulting incoming is absent, do NOT post a second outgoing.
// Never enable accounting-only-in-chain=true and never treat this as proof
// that generic REST imports automatically create linked incoming invoices.
const id=x=>String(x??"").trim().replace(/^[{]+|[}]+$/g,"").toLowerCase();
const PREVIEW_HOST="feature-internal-orders-rms.smarthoreca.pages.dev";
export const UNSUPPORTED_STORE_BUYER_MESSAGE=
  "Ранее REST API отклонил расходную, потому что вместо контрагента User был передан ID склада Store. "+
  "Отдельный контрагент для RMS уже может быть подтверждён по справочнику, но создание связанной приходной через REST пока не доказано. "+
  "Автоматическая отгрузка через этот API временно заблокирована; новая попытка списания не выполняется. Состояние ранее отправленных документов требует отдельной проверки.";

export function assessInternalShipmentRoute(order,{mapping=null,host=""}={}){
  const source=id(order?.central_department_id),destination=id(order?.destination_department_id);
  const sourceStore=id(order?.central_store_id),receiver=id(order?.destination_store_id);
  if(!source||!destination||source===destination||!sourceStore||!receiver||sourceStore===receiver)
    return {supported:false,code:"IIKO_ROUTE_UNVERIFIED",message:"Отгрузка не поддерживается без подтверждённого API для этой пары RMS и складов."};
  if(host!==PREVIEW_HOST)
    return {supported:false,code:"TEST_PREVIEW_ONLY",message:"Пробная REST-отгрузка разрешена только на тестовом адресе внутреннего заказа. В основной системе отгрузка заблокирована."};
  const m=mapping;
  // Exact stored evidence from the already inspected successful iikoChain pair.
  // Prevent activating the experimental transport for unrelated RMS destinations.
  if(!m||id(m.source_store_id)!==sourceStore||id(m.destination_store_id)!==receiver||
     id(m.outgoing_buyer_id)===receiver||id(m.incoming_supplier_id)===sourceStore||
     !id(m.outgoing_buyer_id)||!id(m.incoming_supplier_id)||
     !id(m.evidence_outgoing_id)||!id(m.evidence_incoming_id)||
     String(m.evidence_outgoing_number||"").trim()!=="50001"||
     String(m.evidence_incoming_number||"").trim()!=="10001")
    return {supported:false,code:"TEST_ROUTE_NOT_CONFIRMED",
      message:"Пробная отгрузка разрешена только для подтверждённой пары Mərkəzi Anbar → RMS 1 METBEX по документам №50001 / №10001."};
  return {supported:true,code:"CONFIRMED_TEST_ROUTE",testOnly:true,
    message:"Тестовая отгрузка разрешена только для этой пары складов. Связанную приходную и синхронизацию RMS нужно проверить после проведения."};
}
