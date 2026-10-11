// Read-only discovery of the incoming invoice linked to an existing outgoing.
// It never creates invoices, writes to inventory, or approves receipt.
import {iikoText} from "../iiko/_lib/iiko-client.js";
import {extractIikoInvoiceSummaries,compareIikoInvoicePair} from "./internal-order-pair-probe.js";
const clean=v=>String(v??"").trim();
const id=v=>clean(v).replace(/^[{]+|[}]+$/g,"").toLowerCase();
const pad=x=>String(x).padStart(2,"0");
const iso=d=>new Date(d.getTime()).toISOString().slice(0,10);
const ru=d=>d.slice(8,10)+"."+d.slice(5,7)+"."+d.slice(0,4);
function candidateSummary(doc){
  if(!doc)return null;
  return {id:doc.id,number:doc.number,status:doc.status,storeId:doc.storeId,
    supplierId:doc.supplierId,linkedOutgoingInvoiceId:doc.linkedOutgoingInvoiceId,
    incomingDocumentNumber:doc.incomingDocumentNumber,itemsCount:doc.itemsCount};
}
export function classifyLinkedIncoming(outgoing,documents=[],{recipientStoreId="",supplierId=""}={}){
  if(!id(outgoing?.id)||!clean(outgoing?.number))
    return {found:false,confirmed:false,code:"OUTGOING_ID_MISSING",message:"Расходная не содержит подтверждённого ID и номера."};
  const strict=documents.filter(x=>id(x.linkedOutgoingInvoiceId)===id(outgoing.id));
  if(strict.length>1)return {found:true,confirmed:false,code:"MULTIPLE_LINKED_INCOMING",
    candidates:strict.slice(0,5).map(candidateSummary),
    message:"Найдено несколько приходных с одинаковым ID связанной расходной. Нужна ручная проверка."};
  if(strict.length===0){
    const byNumber=documents.filter(x=>id(x.incomingDocumentNumber)===id(outgoing.number));
    return {found:byNumber.length>0,confirmed:false,code:byNumber.length?"LINK_ID_UNCONFIRMED":"LINKED_INCOMING_NOT_FOUND",
      candidates:byNumber.slice(0,5).map(candidateSummary),
      message:byNumber.length?"Есть приходная с совпадающим номером расходной, но связь по UUID не подтверждена.":
        "Приходная со ссылкой на ID расходной пока не найдена. Это не доказывает, что её нет на сервере."};
  }
  const incoming=strict[0],pair=compareIikoInvoicePair(outgoing,incoming);
  if(recipientStoreId&&id(incoming.storeId)!==id(recipientStoreId))
    return {found:true,confirmed:false,code:"WRONG_RECIPIENT_STORE",incoming:candidateSummary(incoming),
      message:"Связанная приходная указывает не на ожидаемый склад RMS-получателя."};
  if(supplierId&&id(incoming.supplierId)!==id(supplierId))
    return {found:true,confirmed:false,code:"WRONG_INCOMING_SUPPLIER",incoming:candidateSummary(incoming),
      message:"Поставщик связанной приходной не совпадает с сохранённым внутренним контрагентом."};
  if(!pair.productsMatch)
    return {found:true,confirmed:false,code:"LINE_ITEMS_MISMATCH",incoming:candidateSummary(incoming),
      message:"Связь по UUID есть, но товары или количества расходной и приходной не совпадают."};
  return {found:true,confirmed:true,code:"LINKED_INCOMING_CONFIRMED",incoming:candidateSummary(incoming),
    receiptPosted:clean(incoming.status).toUpperCase()==="PROCESSED",
    message:clean(incoming.status).toUpperCase()==="PROCESSED"
      ?"Связанная приходная найдена и проведена. Товары и количества совпадают.":
      "Связанная приходная найдена, но её проведение получателем ещё не подтверждено."};
}
export async function findLinkedIncomingInvoices(connection,outgoing,{recipientStoreId="",supplierId="",request=iikoText}={}){
  const date=String(outgoing?.date||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return {readOnly:true,found:false,confirmed:false,code:"INVALID_OUTGOING_DATE",message:"Не определена дата расходной iiko."};
  const beginning=new Date(date+"T00:00:00.000Z");
  if(Number.isNaN(beginning.valueOf()))
    return {readOnly:true,found:false,confirmed:false,code:"INVALID_OUTGOING_DATE",message:"Некорректная дата расходной."};
  const end=new Date(beginning.getTime()+2*86400000);
  const from=iso(beginning),to=iso(end);
  const formats=[[from,to],[ru(from),ru(to)]],attempts=[],unique=new Map();
  let readOk=false;
  for(const [f,t] of formats){
    const path="/resto/api/documents/export/incomingInvoice?"+new URLSearchParams({from:f,to:t}).toString();
    try{
      const response=await request(connection,path,{headers:{Accept:"application/xml,text/xml,*/*"},timeoutMs:30000});
      const records=response.ok?extractIikoInvoiceSummaries(response.text,"incoming"):[];
      attempts.push({dateFormat:f.includes(".")?"dd.MM.yyyy":"yyyy-MM-dd",status:response.status,found:records.length});
      if(response.ok)readOk=true;
      for(const doc of records)if(id(doc.id))unique.set(id(doc.id),doc);
      if(records.some(doc=>id(doc.linkedOutgoingInvoiceId)===id(outgoing.id)))break;
    }catch(e){attempts.push({dateFormat:f.includes(".")?"dd.MM.yyyy":"yyyy-MM-dd",error:clean(e?.message||e).slice(0,100)});}
  }
  if(!readOk)return {readOnly:true,found:false,confirmed:false,code:"INCOMING_EXPORT_UNAVAILABLE",
    message:"iiko не предоставил данные приходных накладных. Результат неизвестен.",attempts};
  const result=classifyLinkedIncoming(outgoing,[...unique.values()],{recipientStoreId,supplierId});
  return {readOnly:true,stockOperation:false,...result,attempts};
}
