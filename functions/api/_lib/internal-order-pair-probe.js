// Read-only inspector for an iikoChain outgoing + linked incoming example.
// No POST to iiko, no stock operation, no raw XML returned to the browser.
const clean=x=>String(x??"").trim();
const normalized=x=>clean(x).replace(/^\{+|\}+$/g,"").toLowerCase();
const dec=x=>clean(x).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
const tag=(xml,n)=>dec(String(xml||"").match(new RegExp("<"+n+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+n+">","i"))?.[1]||"");
const blocks=(xml,n)=>[...String(xml||"").matchAll(new RegExp("<"+n+"(?:\\s[^>]*)?>[\\s\\S]*?</"+n+">","gi"))].map(x=>x[0]);
const num=x=>{const value=clean(x);if(!value)return null;const n=Number(value.replace(",","."));return Number.isFinite(n)?n:null;};
export function extractIikoInvoiceSummaries(xml,kind){
  const source=String(xml||"");
  let documents=blocks(source,"document");
  if(!documents.length)documents=blocks(source,kind==="outgoing"?"outgoingInvoice":"incomingInvoice");
  return documents.map(doc=>{
    const items=blocks(doc,"item").map(l=>({
      productId:tag(l,"productId")||tag(l,"product"),
      amount:num(tag(l,"amount")),
      storeId:tag(l,"storeId")||tag(l,"store"),
      price:num(tag(l,"price")),
      sum:num(tag(l,"sum"))
    }));
    return {
      id:tag(doc,"id"),
      number:tag(doc,"documentNumber")||tag(doc,"number"),
      status:tag(doc,"status"),
      date:tag(doc,"dateIncoming")||tag(doc,"date"),
      storeId:tag(doc,"defaultStoreId")||tag(doc,"defaultStore")||tag(doc,"store"),
      counteragentId:tag(doc,"counteragentId")||tag(doc,"counteragent"),
      counteragentCode:tag(doc,"counteragentCode"),
      counteragentType:tag(doc,"counteragentType")||tag(doc,"buyerType")||tag(doc,"customerType"),
      supplierId:tag(doc,"supplierId")||tag(doc,"supplier"),
      incomingDocumentNumber:tag(doc,"incomingDocumentNumber"),
      linkedOutgoingInvoiceId:tag(doc,"linkedOutgoingInvoiceId"),
      relatedIncomingInvoiceId:tag(doc,"internalIncomingInvoiceId")||tag(doc,"linkedIncomingInvoiceId"),
      itemsCount:items.length,
      items:items.slice(0,30)
    };
  }).filter(x=>x.number||x.id);
}
export function compareIikoInvoicePair(outgoing,incoming){
  if(!outgoing||!incoming)return {hasPair:false,linkEvidence:"Не получен хотя бы один документ из API."};
  const sameRef=Boolean(outgoing.id&&incoming.linkedOutgoingInvoiceId&&normalized(outgoing.id)===normalized(incoming.linkedOutgoingInvoiceId));
  const sameNumber=Boolean(outgoing.number&&incoming.incomingDocumentNumber&&normalized(outgoing.number)===normalized(incoming.incomingDocumentNumber));
  const inMap=new Map(incoming.items.map(x=>[normalized(x.productId),x]));
  const productsMatch=outgoing.itemsCount>0&&incoming.itemsCount>0&&outgoing.items.length===incoming.items.length&&outgoing.items.every(x=>{
    const i=inMap.get(normalized(x.productId));
    return i&&Number.isFinite(x.amount)&&Number.isFinite(i.amount)&&Math.abs(x.amount-i.amount)<0.0005;
  });
  return {
    hasPair:true,
    linkConfirmed: sameRef||sameNumber,
    linkEvidence:sameRef?"API incoming.linkedOutgoingInvoiceId совпадает с outgoing.id":sameNumber?"API incoming.incomingDocumentNumber совпадает с outgoing.number":"Связь не подтверждена экспортированными полями; скриншоты могут подтверждать её визуально.",
    outgoingBuyerId:outgoing.counteragentId,
    incomingSupplierId:incoming.supplierId,
    outgoingStoreId:outgoing.storeId,
    incomingStoreId:incoming.storeId,
    productsMatch,
    noStockOperation:true
  };
}

export function identifyIikoPairCounteragents(outgoing,incoming,suppliers=[]){
  const byId=new Map((suppliers||[]).filter(x=>x?.id).map(x=>[normalized(x.id),{id:x.id,name:clean(x.name),code:clean(x.code)}]));
  const outgoingBuyerId=normalized(outgoing?.counteragentId),
        incomingSupplierId=normalized(incoming?.supplierId);
  const buyer=byId.get(outgoingBuyerId)||null,
        supplier=byId.get(incomingSupplierId)||null;
  return {
    outgoingBuyerId:clean(outgoing?.counteragentId),
    outgoingBuyerSupplier:buyer,
    incomingSupplierId:clean(incoming?.supplierId),
    incomingSupplierRecord:supplier,
    outgoingBuyerIsDestinationStore:!!outgoingBuyerId&&outgoingBuyerId===normalized(incoming?.storeId),
    incomingSupplierIsSenderStore:!!incomingSupplierId&&incomingSupplierId===normalized(outgoing?.storeId),
    supplierDirectoryLookedUp:(suppliers||[]).length>0,
    supplierDirectoryMatchedOutgoingBuyer:!!buyer,
    supplierDirectoryMatchedIncomingSupplier:!!supplier
  };
}
