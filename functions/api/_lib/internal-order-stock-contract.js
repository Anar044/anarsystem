// Pure, non-posting stock valuation and replication contract for internal RMS shipments.
// Ordinary iikoChain + iikoRMS accounting only. This module cannot alter server settings.
// Do NOT derive the accounting mode from missing data or claim live reconciliation.
const eps=0.0005;
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const money=x=>Math.round((x+Number.EPSILON)*100)/100;
const clean=x=>String(x??"").trim();
const reject=(code,message)=>({valid:false,code,message});
export function assessDualAccountingMode({accountingOnlyInChain,source="unknown"}={}){
  if(accountingOnlyInChain===true)return reject("CHAIN_ONLY_MODE_FORBIDDEN",
    "Режим accounting-only-in-chain=true запрещён для внутренних заказов Smart Horeca: нужен раздельный учёт остатков и стоимости в Chain и RMS.");
  if(accountingOnlyInChain!==false)return reject("ACCOUNTING_MODE_UNVERIFIED",
    "Нельзя включить реальную отгрузку, пока режим раздельного учёта Chain и RMS не подтверждён на сервере.");
  return {valid:true,code:"DUAL_CHAIN_RMS_ACCOUNTING",mode:"ordinary",source:clean(source),
    message:"Подтверждён обычный складской учёт iikoChain и iikoRMS."};
}
// This is an EXPECTED movement, not a journal entry, balance write, or fetched stock.
// Values are total inventory valuations; unit-cost basis at the recipient may differ.
export function expectedInternalStockMovement({quantity,unitCost}={}){
  if(!finite(quantity)||quantity<=0||Math.abs(quantity*1000-Math.round(quantity*1000))>0.00001)
    return reject("INVALID_QUANTITY","Количество должно быть больше нуля, точность до 0,001.");
  if(!finite(unitCost)||unitCost<0)return reject("INVALID_COST","Себестоимость за единицу должна быть подтверждённым неотрицательным числом.");
  const value=money(quantity*unitCost);
  return {valid:true,quantity,value,
    outgoing:{quantityDelta:-quantity,inventoryValueDelta:value===0?0:-value},
    incoming:{quantityDelta:quantity,inventoryValueDelta:value},
    inTransit:{quantity,value},
    marginAdded:0,
    message:"После расходной уменьшаются количество и стоимость запасов отправителя; после проведения приходной они увеличиваются у получателя."};
}
function match(actual,expected,tolerance){return finite(actual)&&finite(expected)&&Math.abs(actual-expected)<=tolerance;}
// Compare matched warehouse/product/cutoff snapshots from Chain and the owning RMS.
// The caller MUST supply same physical store, unit, valuation method, and a completed
// synchronization watermark. Never report "equal" for incompatible/stale snapshots.
export function compareChainRmsStockSnapshot(chain,rms,{sameWarehouse=false,sameProduct=false,
  sameUnit=false,sameValuationBasis=false,synced=false}={}){
  if(!sameWarehouse||!sameProduct||!sameUnit||!sameValuationBasis)
    return reject("SCOPE_MISMATCH","Для сверки нужны один склад и товар, одинаковые единицы и сопоставимая база оценки запасов.");
  if(!synced)return reject("SYNC_NOT_COMPLETE","Обмен Chain ↔ RMS ещё не завершён; расхождение пока не подтверждено.");
  if(!finite(chain?.quantity)||!finite(rms?.quantity)||!finite(chain?.inventoryValue)||
     !finite(rms?.inventoryValue))
    return reject("BALANCES_MISSING","Не получены достоверные количество и стоимость запасов из обеих систем.");
  const quantityDifference=Math.round((chain.quantity-rms.quantity)*1000)/1000;
  const inventoryValueDifference=money(chain.inventoryValue-rms.inventoryValue);
  const reconciled=match(quantityDifference,0,eps)&&match(inventoryValueDifference,0,0.005);
  return {valid:true,reconciled,code:reconciled?"MATCHED":"STOCK_DIFFERENCE",
    quantityDifference,inventoryValueDifference,
    message:reconciled?"Остаток и стоимость запасов совпадают в iikoChain и iikoRMS.":"Обнаружено расхождение количества или стоимости запасов после завершённого обмена."};
}
