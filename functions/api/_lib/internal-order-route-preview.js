// Read-only preflight for one confirmed iikoChain warehouse pair.
// It does not authorize document creation, posting or remote stock changes.
const id=value=>String(value??"").trim().replace(/^[{]+|[}]+$/g,"").toLowerCase();
const fail=(code,message)=>({valid:false,readOnly:true,canDispatch:false,code,message});
export function previewConfirmedInternalRoute(order,mapping,suppliers=[]){
  const source=id(order?.central_store_id),destination=id(order?.destination_store_id);
  const sourceDepartment=id(order?.central_department_id),destinationDepartment=id(order?.destination_department_id);
  if(!source||!destination||source===destination||!sourceDepartment||!destinationDepartment||sourceDepartment===destinationDepartment)
    return fail("INVALID_WAREHOUSE_PAIR","Нужны два разных RMS и два разных склада, подтверждённых в iikoChain.");
  if(!mapping)return fail("MAPPING_NOT_CONFIRMED","Для этой пары складов ещё нет подтверждённого сопоставления по связанной паре накладных iiko.");
  if(id(mapping.source_store_id)!==source||id(mapping.destination_store_id)!==destination)
    return fail("MAPPING_MISMATCH","Сохранённое сопоставление относится к другой паре складов.");
  const buyer=id(mapping.outgoing_buyer_id),sender=id(mapping.incoming_supplier_id);
  if(!buyer||!sender||buyer===source||buyer===destination||sender===source||sender===destination)
    return fail("INVALID_COUNTERPARTY","Для расходной и приходной требуются отдельные ID контрагентов, а не ID складов.");
  if(!id(mapping.evidence_outgoing_id)||!id(mapping.evidence_incoming_id)||!String(mapping.evidence_outgoing_number||"").trim()||!String(mapping.evidence_incoming_number||"").trim())
    return fail("MISSING_PAIR_EVIDENCE","Не сохранены идентификаторы подтверждённой пары накладных.");
  const references=new Map((suppliers||[]).filter(x=>x?.id).map(x=>[id(x.id),x]));
  const buyerReference=references.get(buyer),senderReference=references.get(sender);
  if(!buyerReference||!senderReference||!String(buyerReference.name||"").trim()||!String(senderReference.name||"").trim())
    return fail("SUPPLIER_NOT_FOUND","Покупатель расходной или поставщик приходной больше не найден в актуальном справочнике контрагентов iiko.");
  return {
    valid:true,readOnly:true,canDispatch:false,
    sourceStoreId:source,destinationStoreId:destination,
    outgoing:{defaultStoreId:source,counteragentId:buyer,counteragentName:String(buyerReference.name)},
    expectedIncoming:{recipientStoreId:destination,supplierId:sender,supplierName:String(senderReference.name)},
    evidence:{outgoingNumber:String(mapping.evidence_outgoing_number),incomingNumber:String(mapping.evidence_incoming_number),confirmedAt:String(mapping.confirmed_at||"")},
    message:"Склады и контрагенты подтверждены по справочнику iiko. Создание связанной приходной через REST ещё не подтверждено; реальная отгрузка заблокирована."
  };
}
