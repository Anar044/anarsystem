// Validated cross-RMS outgoingInvoice route. Never silently substitute
// the recipient warehouse ID for the independent iiko buyer counterparty.
// A missing/incorrect mapping blocks stock posting; unknown remote outcomes
// remain non-retryable until reconciled.
const id=x=>String(x??"").trim().replace(/^[{]+|[}]+$/g,"").toLowerCase();
export const UNSUPPORTED_STORE_BUYER_MESSAGE=
  "ID склада RMS не является ID внутреннего контрагента-покупателя расходной. "+
  "Для новой отгрузки требуется подтверждённое сопоставление складов и контрагентов, "+
  "а ранее отправленные документы с неизвестным результатом необходимо сверить в iiko до продолжения.";

export function assessInternalShipmentRoute(order,{mapping=null}={}){
  const source=id(order?.central_department_id),destination=id(order?.destination_department_id);
  const sourceStore=id(order?.central_store_id),receiver=id(order?.destination_store_id);
  if(!source||!destination||source===destination||!sourceStore||!receiver||sourceStore===receiver)
    return {supported:false,code:"IIKO_ROUTE_UNVERIFIED",message:"Укажите разные RMS и склады отправителя/получателя для отгрузки."};
  const m=mapping;
  if(!m||id(m.source_store_id)!==sourceStore||id(m.destination_store_id)!==receiver||
     !id(m.outgoing_buyer_id)||!id(m.incoming_supplier_id)||
     id(m.outgoing_buyer_id)===receiver||id(m.incoming_supplier_id)===sourceStore||
     !id(m.evidence_outgoing_id)||!id(m.evidence_incoming_id)||
     !String(m.evidence_outgoing_number||"").trim()||
     !String(m.evidence_incoming_number||"").trim())
    return {supported:false,code:"ROUTE_MAPPING_REQUIRED",
      message:"Для этой пары складов не подтверждены отдельные внутренние контрагенты и связанная пара расходной/приходной. Сначала сохраните сопоставление в настройках."};
  return {supported:true,code:"CONFIRMED_RMS_ROUTE",
    message:"Склады и внутренние контрагенты подтверждены. При отгрузке используется уникальная расходная с последующей проверкой связанной приходной."};
}
