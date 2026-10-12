// Search iiko outgoing invoices through both supported read-only export paths.
// /byNumber can be unsupported for some iiko versions and return HTTP 500.
// Never infer absence based solely on one failing endpoint.
import {iikoText} from "../iiko/_lib/iiko-client.js";
import {parseOutgoingForVerification} from "./internal-order-invoice.js";
const clean=v=>String(v??"").trim();
const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):new Date().toISOString().slice(0,10);
const russian=d=>d.slice(8,10)+"."+d.slice(5,7)+"."+d.slice(0,4);
export async function findOutgoingInvoices(connection,number,date,{request=iikoText}={}){
  const target=clean(number).toLowerCase();
  if(!target||target.length>120)throw new Error("Нужен номер расходной накладной.");
  const since=iso(date),until=new Date().toISOString().slice(0,10);
  const from=since<=until?since:until,to=since>until?since:until;
  const paths=[
    "/resto/api/documents/export/outgoingInvoice/byNumber?"+new URLSearchParams({number:clean(number),currentYear:"false",from,to}).toString(),
    "/resto/api/documents/export/outgoingInvoice?"+new URLSearchParams({from,to}).toString(),
    "/resto/api/documents/export/outgoingInvoice?"+new URLSearchParams({from:russian(from),to:russian(to)}).toString()
  ];
  const seen=new Map(),attempts=[];
  let trustworthyRead=false;
  for(const path of paths){
    let response;
    try{response=await request(connection,path,{headers:{Accept:"application/xml,text/xml,*/*"},timeoutMs:30000})}
    catch(e){attempts.push({path:path.includes("byNumber")?"byNumber":"export",error:String(e?.message||e).slice(0,110)});continue}
    const docs=response.ok?parseOutgoingForVerification(response.text):[];
    const matches=docs.filter(d=>clean(d.number).toLowerCase()===target);
    attempts.push({path:path.includes("byNumber")?"byNumber":"export",status:response.status,ok:response.ok,received:docs.length,matched:matches.length});
    if(response.ok&&!path.includes("byNumber"))trustworthyRead=true;
    for(const d of matches)seen.set(clean(d.id||d.number).toLowerCase(),d);
    // In normal cases avoid repeated iiko queries once the document is found.
    if(matches.length)break;
  }
  return {documents:[...seen.values()],checked:trustworthyRead||attempts.some(a=>a.path==="byNumber"&&a.ok),attempts};
}
