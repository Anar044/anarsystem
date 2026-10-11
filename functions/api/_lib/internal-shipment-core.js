// Pure calculations for internal shipment: base units and per-base-unit sale prices.
const id=x=>String(x??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase();
const cents=x=>Math.round(Number(x)*100);
export function prepareInternalShipment(approved,existing,requested){
  if(!Array.isArray(approved)||!approved.length)throw new Error("Согласованные товары заказа не найдены.");
  if(!Array.isArray(requested)||!requested.length)throw new Error("Выберите хотя бы один товар для отгрузки.");
  const approvedMap=new Map(approved.map(x=>[id(x.productId),x]));
  const remaining=new Map(approved.map(x=>[id(x.productId),Number(x.quantity)]));
  for(const shipment of existing||[]){
    if(shipment.status==="CANCELLED")continue;
    for(const l of shipment.lines||[]){
      const p=id(l.productId);
      if(remaining.has(p))remaining.set(p,Math.round((remaining.get(p)-Number(l.amount))*1000)/1000);
    }
  }
  const visited=new Set(),lines=[];
  for(const l of requested){
    const productId=id(l.productId),a=approvedMap.get(productId);
    if(!a||visited.has(productId))throw new Error("Товар не согласован в заказе или повторяется.");
    visited.add(productId);
    const amount=Number(l.amount),unitPrice=Number(l.unitPrice);
    if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*1000)-amount*1000)>0.00001)throw new Error("Количество должно быть положительным, точность — до 0,001.");
    if(!Number.isFinite(unitPrice)||unitPrice<=0||Math.abs(Math.round(unitPrice*100)-unitPrice*100)>0.00001)throw new Error("Для разных VÖEN укажите положительную отпускную цену с точностью 0,01 ₼.");
    if(amount>Number(remaining.get(productId)||0)+0.00001)throw new Error("Отгрузка превышает неисполненное количество заказа.");
    lines.push({productId:a.productId,productName:a.productName,unit:a.unit,amount,unitPrice,priceCents:cents(unitPrice),sumCents:Math.round(amount*cents(unitPrice))});
  }
  return {lines,totalCents:lines.reduce((sum,l)=>sum+l.sumCents,0),remaining:Object.fromEntries(remaining)};
}
export function shipmentXml({id:documentId,number,date,storeId,counteragentId,comment,accountToCode,revenueAccountCode,lines}){
  const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const tag=(name,x)=>x===undefined||x===null||String(x)===""?"":'<'+name+'>'+esc(x)+'</'+name+'>';
  const items=lines.map((l,i)=>'<item>'+tag("productId",l.productId)+tag("storeId",storeId)+tag("amount",l.amount)+tag("price",(l.priceCents/100).toFixed(2))+tag("sum",(l.sumCents/100).toFixed(2))+'</item>').join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><document>'+tag("id",documentId)+tag("documentNumber",number)+tag("dateIncoming",date+"T00:00:00")+tag("defaultStoreId",storeId)+tag("counteragentId",counteragentId)+tag("accountToCode",accountToCode)+tag("revenueAccountCode",revenueAccountCode)+tag("comment",comment)+'<items>'+items+'</items></document>';
}
export function parseIikoValidation(xml){
  const dec=v=>String(v||"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
  const val=name=>dec(String(xml||"").match(new RegExp("<"+name+">([\\s\\S]*?)</"+name+">","i"))?.[1]||"").trim();
  return {valid:val("valid"),documentNumber:val("documentNumber"),errorMessage:val("errorMessage"),additionalInfo:val("additionalInfo")};
}
