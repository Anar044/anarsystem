// Pure workflow rules: no iiko writes and no warehouse stock adjustments.
export function normalizeInternalLines(input){
  if(!Array.isArray(input)||!input.length||input.length>200)throw new Error("В заказе должно быть от 1 до 200 позиций.");
  const seen=new Set(),out=[];
  for(const x of input){
    const productId=String(x?.productId||"").trim(),productName=String(x?.productName||"").trim();
    const packageSize=Number(x?.packageSize??1),packageCount=Number(x?.packageCount);
    if(!productId||!productName)throw new Error("Укажите товар из справочника iiko.");
    if(seen.has(productId.toLowerCase()))throw new Error("Товар повторяется в заказе.");
    if(!Number.isFinite(packageSize)||packageSize<=0||!Number.isFinite(packageCount)||packageCount<=0||packageCount>100000)throw new Error("Неверное количество или фасовка.");
    const quantity=Math.round(packageSize*packageCount*1000)/1000;
    if(quantity<=0||quantity>1000000)throw new Error("Неверное количество товара.");
    seen.add(productId.toLowerCase());
    out.push({productId,productName:productName.slice(0,240),unit:String(x?.unit||"").slice(0,30),packageSize,packageCount,quantity,containerId:String(x?.containerId||""),packageName:String(x?.packageName||"")});
  }
  return out;
}
export function validateApproval(requested,input){
  if(!Array.isArray(input)||input.length!==requested.length)throw new Error("Количество согласованных позиций не совпадает с заказом.");
  return requested.map((r,i)=>{
    const v=input.find(x=>x.productId===r.productId);
    const count=Number(v?.packageCount);
    if(!Number.isFinite(count)||count<0||count>r.packageCount)throw new Error("Нельзя подтвердить количество больше заказанного или отрицательное.");
    return {...r,packageCount:count,quantity:Math.round(count*r.packageSize*1000)/1000};
  });
}
const transitions={
  submit:{DRAFT:"SUBMITTED"},
  cancel:{DRAFT:"CANCELLED",SUBMITTED:"CANCELLED"},
  approve:{SUBMITTED:"APPROVED"},
  reject:{SUBMITTED:"REJECTED"},
  picking:{APPROVED:"PICKING"},
  ready:{PICKING:"READY"}
};
export function internalNextStatus(status,action){
  const next=transitions[action]?.[status];
  if(!next)throw Object.assign(new Error("Недопустимый переход статуса: "+status+" → "+action),{status:409});
  return next;
}
