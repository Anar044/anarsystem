// Parse the native iikoChain /v2/reports/balance/stores value for ONE approved RMS warehouse.
// Cost is indicative warehouse valuation; iiko can recalculate on backdated postings.
const key=v=>String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function ref(v){return key(v&&typeof v==="object"?(v.id??v.uuid??v.entityId??v.storeId??v.productId):v)}
function flatten(v){
  if(Array.isArray(v))return v;
  if(!v||typeof v!=="object")return [];
  for(const n of ["rows","data","items","results","balances","response"]){if(v[n]!=null){const a=flatten(v[n]);if(a.length)return a}}
  return [];
}
export function warehouseCostRows(payload,storeId,productIds=[]){
  const want=key(storeId),allowed=new Set((productIds||[]).map(key).filter(Boolean));
  const rows=flatten(payload),byProduct=new Map();
  for(const x of rows){
    const sid=ref(x?.store??x?.storeId??x?.warehouse??x?.warehouseId);
    const pid=ref(x?.product??x?.productId);
    if(!want||sid!==want||!pid||(allowed.size&&!allowed.has(pid)))continue;
    const amount=num(x.amount??x.quantity??x.qty),sum=num(x.sum??x.costSum??x.value);
    // A warehouse's actual cost cannot be inferred from another warehouse's
    // value, nor from a catalogue-wide average. Never default missing cost to 0.
    if(amount===null||sum===null)continue;
    const prev=byProduct.get(pid)||{productId:pid,storeId:want,amount:0,sum:0};
    prev.amount+=amount;prev.sum+=sum;byProduct.set(pid,prev);
  }
  return [...byProduct.values()].map(x=>({...x,unitCost:x.amount>0&&x.sum>0?x.sum/x.amount:null}));
}
export function costQuote(approved,balances,shipmentDate){
  const byId=new Map((balances||[]).map(x=>[key(x.productId),x]));
  return (approved||[]).map(x=>{
    const id=key(x.productId),stock=byId.get(id);
    const available=Number(stock?.amount),unitCost=stock?.unitCost;
    return {productId:x.productId,productName:x.productName||"",available:Number.isFinite(available)?available:null,unitCost:Number.isFinite(unitCost)&&unitCost>0?Number(unitCost.toFixed(6)):null,
      verified:Boolean(stock)&&available>0&&unitCost>0,costSource:"iikoChain warehouse balance",costTimestamp:shipmentDate+"T23:59:59"};
  });
}

/**
 * A REST_API(2000) 403 is an iiko Server license / concurrent-session limit,
 * not a Smart Horeca role denial. Keep credentials and raw auth body out of UI.
 */
export function classifyRestApiLicenseError(error){
  const message=String(error?.message||error||"");
  if(!/\b(?:REST_API\s*\(?\s*2000\s*\)?|API\s*\(RestApi\))\b/i.test(message)
      && !/REST_API\s*\(2000\)/i.test(message))return null;
  if(!/\b403\b|no connections available|license enhancement is required/i.test(message))return null;
  return{
    code:"IIKO_REST_API_LICENSE_UNAVAILABLE",
    status:503,
    message:"iiko Server отказал в подключении REST API (HTTP 403): нет свободной лицензии или доступных сеансов REST_API(2000). Проверьте лицензии и активные API-подключения на сервере iiko. Пока доступ не восстановлен, себестоимость неизвестна, отгрузка заблокирована."
  };
}
