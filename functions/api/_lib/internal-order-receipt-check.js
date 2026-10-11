// Verify an exported, posted outgoing against exactly one local shipment.
// This is read-only evidence for iiko receipt tracking, NOT inventory posting.
const id=x=>String(x??"").trim().replace(/^[{]+|[}]+$/g,"").toLowerCase();
const n=x=>Number(x);
const no=(code,message)=>({valid:false,code,message});
export function validateShipmentOutgoingForReceipt(shipment,outgoing,expectedBuyerId){
  if(!shipment||!outgoing)return no("MISSING_DOCUMENT","Не получена сохранённая отгрузка или расходная iiko.");
  if(!id(shipment.iiko_document_id)||id(outgoing.id)!==id(shipment.iiko_document_id))
    return no("DOCUMENT_ID_MISMATCH","UUID расходной не совпадает с UUID отгрузки Smart Horeca.");
  if(!id(shipment.number)||id(outgoing.number)!==id(shipment.iiko_document_number||shipment.number))
    return no("DOCUMENT_NUMBER_MISMATCH","Номер расходной отличается от зарегистрированной отгрузки.");
  if(String(outgoing.status||"").trim().toUpperCase()!=="PROCESSED")
    return no("OUTGOING_NOT_PROCESSED","Расходная ещё не проведена в iiko.");
  if(!id(shipment.source_store_id)||id(outgoing.storeId)!==id(shipment.source_store_id))
    return no("SOURCE_STORE_MISMATCH","Склад расходной отличается от склада отправителя.");
  if(!id(expectedBuyerId)||id(shipment.counteragent_id)!==id(expectedBuyerId)||id(outgoing.counteragentId)!==id(expectedBuyerId))
    return no("BUYER_MISMATCH","Контрагент расходной отличается от подтверждённого покупателя RMS.");
  let localLines;
  try{localLines=JSON.parse(shipment.lines_json||"[]")}catch{return no("INVALID_SHIPMENT_LINES","Сохранённые позиции отгрузки повреждены.");}
  const remote=outgoing.items||[];
  if(!Array.isArray(localLines)||!localLines.length||!Array.isArray(remote)||!remote.length)
    return no("MISSING_LINES","В расходной или сохранённой отгрузке отсутствуют позиции.");
  if(remote.length!==n(outgoing.itemsCount)||remote.length!==localLines.length)
    return no("LINE_COUNT_MISMATCH","Количество позиций расходной не совпадает с сохранённой отгрузкой.");
  const expected=new Map();
  for(const l of localLines){
    const key=id(l.productId);
    if(!key||expected.has(key))return no("DUPLICATE_LOCAL_PRODUCT","В сохранённой отгрузке есть повторяющийся товар.");
    const qty=n(l.amount),price=n(l.unitPrice),sum=n(l.sumCents)/100;
    if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0||!Number.isFinite(sum))
      return no("INVALID_LOCAL_LINE","В сохранённой отгрузке есть некорректное количество или сумма.");
    expected.set(key,{qty,price,sum});
  }
  const seen=new Set();
  for(const line of remote){
    const key=id(line.productId),x=expected.get(key);
    if(!key||!x||seen.has(key))return no("UNEXPECTED_PRODUCT","В расходной iiko есть лишний или повторяющийся товар.");
    seen.add(key);
    if(!Number.isFinite(line.amount)||Math.abs(n(line.amount)-x.qty)>0.0005)
      return no("QUANTITY_MISMATCH","Количество товара в расходной отличается от зарегистрированной отгрузки.");
    if(!Number.isFinite(line.price)||Math.abs(n(line.price)-x.price)>0.009)
      return no("PRICE_MISMATCH","Себестоимость товара в расходной отличается от зарегистрированной отгрузки.");
    if(!Number.isFinite(line.sum)||Math.abs(n(line.sum)-x.sum)>0.015)
      return no("SUM_MISMATCH","Сумма позиции расходной отличается от зарегистрированной отгрузки.");
  }
  return {valid:true,code:"OUTGOING_VERIFIED",message:"Расходная проведена, UUID, склад, покупатель, товары, количество и цены совпадают."};
}
