// One warehouse-name resolver for documents, writeoff and sales acts.
// Stock Balances already parses iiko Office XML as well as JSON; reuse it
// rather than assuming the corporation/stores endpoint returns JSON.
import { iikoText } from "./iiko-client.js";
import { normalizeStores } from "../stock-balances.js";

const clean=v=>String(v??"").trim();
export const warehouseKey=v=>clean(v).replace(/^\\{+|\\}+$/g,"").toLowerCase();
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const meaningful=v=>{const s=clean(v);return s&&!guid.test(s)?s:"";};
export function warehouseLabel(key,map){
 const id=warehouseKey(key);
 return map?.get(id)||("Склад"+(id?" · …"+id.slice(-6):""));
}
export async function warehouseLabels(connection,{scope=null}={}){
 const wanted=new Set((scope?.storeIds||[]).map(warehouseKey).filter(Boolean));
 const labels=new Map();
 const add=(key,name)=>{
   const id=warehouseKey(key),label=meaningful(name);
   if(!id||!label||(wanted.size&&!wanted.has(id)))return;
   if(!labels.has(id))labels.set(id,label);
 };
 for(const x of scope?.stores||[])add(x.id,x.name);
 if(wanted.size&&[...wanted].every(x=>labels.has(x)))return labels;
 const sources=[
   "/resto/api/corporation/stores?revisionFrom=-1",
   "/resto/api/corporation/departments?revisionFrom=-1"
 ];
 for(const path of sources){
   let result;
   try{result=await iikoText(connection,path,{headers:{Accept:"application/xml, text/xml, application/json, */*"},timeoutMs:15000});}
   catch{continue}
   if(!result.ok)continue;
   let payload=null;try{payload=JSON.parse(result.text||"null")}catch{}
   for(const x of normalizeStores(result.text,payload))add(x.id,x.name);
   if((wanted.size&&[...wanted].every(x=>labels.has(x)))||(!wanted.size&&labels.size>0))break;
 }
 return labels;
}
