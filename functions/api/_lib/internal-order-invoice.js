// Read-only verification of an existing iiko outgoing invoice against an internal RMS order.
// DO NOT treat this as posting, authorising sale, or confirming linked incoming.
const clean=v=>String(v??"").trim();
const key=v=>clean(v).replace(/^\{+|\}+$/g,"").toLowerCase();
const decode=v=>String(v??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
const tag=(source,name)=>{const m=String(source||"").match(new RegExp("<"+name+"(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</"+name+">","i"));return m?decode(m[1]).trim():""};
const blocks=(source,name)=>[...String(source||"").matchAll(new RegExp("<"+name+"(?:\\\\s[^>]*)?>[\\\\s\\\\S]*?</"+name+">","gi"))].map(x=>x[0]);
export function parseOutgoingForVerification(xml){
  return blocks(xml,"document").map(b=>({
    id:tag(b,"id"),
    number:tag(b,"documentNumber"),
    status:tag(b,"status").toUpperCase(),
    storeId:tag(b,"defaultStoreId")||tag(b,"defaultStore"),
    counteragentId:tag(b,"counteragentId")||tag(b,"counteragent"),
    items:blocks(b,"item").map(l=>({
      productId:tag(l,"productId")||tag(l,"product"),
      storeId:tag(l,"storeId")||tag(l,"store"),
      amount:Number(tag(l,"amount").replace(",",".")),
      price:Number(tag(l,"price").replace(",",".")),
      sum:Number(tag(l,"sum").replace(",","."))
    }))
  })).filter(x=>x.id||x.number);
}
export function inspectOutgoingForOrder(order,documents,requestedNumber){
  const target=clean(requestedNumber).toLowerCase();
  const candidates=(documents||[]).filter(x=>clean(x.number).toLowerCase()===target);
  if(candidates.length!==1)return {valid:false,message:candidates.length?"Найдено несколько накладных с таким номером. Уточните уникальный документ в iiko.":"Расходная накладная с таким номером не найдена в iiko."};
  const doc=candidates[0];
  const expectedStore=key(order?.sourceStoreId||order?.centralStoreId);
  const seenStores=[doc.storeId,...(doc.items||[]).map(x=>x.storeId)].map(key).filter(Boolean);
  if(!expectedStore||!seenStores.length)return {valid:false,message:"Не удаётся подтвердить склад расходной накладной."};
  if(seenStores.some(x=>x!==expectedStore))return {valid:false,message:"В накладной указан склад другого RMS.",documentNumber:doc.number};
  const expected=new Map((order?.approvedLines||[]).map(x=>[key(x.productId),Number(x.quantity)]));
  const actual=new Map();
  for(const line of doc.items||[]){
    const id=key(line.productId),q=Number(line.amount);
    if(!id||!expected.has(id))return {valid:false,message:"В накладной есть товар, не согласованный в заказе.",documentNumber:doc.number};
    if(!Number.isFinite(q)||!(q>0))return {valid:false,message:"Некорректное количество в расходной накладной.",documentNumber:doc.number};
    actual.set(id,(actual.get(id)||0)+q);
  }
  if(!actual.size)return {valid:false,message:"В расходной накладной нет товаров.",documentNumber:doc.number};
  const oversized=[...actual].some(([id,qty])=>qty>(expected.get(id)||0)+0.0005);
  if(oversized)return {valid:false,message:"Количество в расходной превышает согласованное количество заказа.",documentNumber:doc.number};
  const items=[...expected].map(([id,approved])=>({productId:id,approvedQty:approved,documentQty:actual.get(id)||0}));
  const partial=items.some(x=>x.documentQty+0.0005<x.approvedQty);
  const processed=doc.status==="PROCESSED";
  return {valid:true,documentId:doc.id,documentNumber:doc.number,processed,status:doc.status||"UNKNOWN",storeId:doc.storeId||expectedStore,counteragentId:doc.counteragentId||"",items,partial,quantityMatched:!partial,sourceStoreValidated:true,
    message:!processed?"Накладная найдена и количества проверены, но в iiko она ещё не проведена.":partial?"Накладная проведена; это частичная отгрузка относительно согласованного заказа.":"Накладная проведена, товары и количества сверены."};
}
