import { serverScopeFromConnection } from "../../_lib/audit-log.js";

// iiko returns incoming-invoice "amount" in base units (kg) even when the
// purchase price is per package. Restore the original pack count/weight from
// the stored procurement invoice lines, without changing iiko quantity or sum.
const text = v => String(v ?? "").trim();
const productKey = v => text(v).replace(/^\{+|\}+$/g, "").toLowerCase();
const number = v => {
  if (v === null || v === undefined || text(v) === "") return NaN;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const near = (a,b,epsilon) => Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=epsilon;
const isProcurement = d =>
  /^PO-\d{8}-[a-z0-9]+/i.test(text(d?.incomingDocumentNumber)) ||
  /Smart Horeca Procurement/i.test(text(d?.comment));

function applyLines(doc,linked) {
  const saved = (()=>{try{return JSON.parse(linked.lines_json||"[]")}catch{return []}})();
  if (!Array.isArray(saved) || !saved.length || !Array.isArray(doc.items)) return doc;
  const used = new Set();
  let enriched = 0;
  const items = doc.items.map(item=>{
    const actualQty=number(item.actualAmount);
    const qty = actualQty>0?actualQty:number(item.amount);
    const price = number(item.price);
    const sum = number(item.sum);
    const matchIndex = saved.findIndex((l,i)=>{
      if (used.has(i)||productKey(l.productId)!==productKey(item.productId))return false;
      if (!near(number(l.quantity),qty,0.0005) || !near(number(l.unitPrice),price,0.009))return false;
      const expectedSum=number(l.total);
      if(Number.isFinite(sum)&&Number.isFinite(expectedSum)&&!near(expectedSum,sum,0.009))return false;
      const size=number(l.packageSize),count=number(l.packageCount);
      return size>0&&count>0&&near(size*count,qty,0.001);
    });
    if (matchIndex<0)return item;
    used.add(matchIndex);enriched++;
    const line=saved[matchIndex];
    return {
      ...item,
      packageSize:number(line.packageSize),
      packageCount:number(line.packageCount),
      actualUnitWeight:number(line.packageSize),
      containerId:item.containerId||line.containerId||"",
      procurementPackageVerified:true
    };
  });
  return enriched?{...doc,items}:doc;
}

export async function enrichProcurementInvoicePackaging(env,connection,documents) {
  if(!env?.DB||!Array.isArray(documents)||!documents.length)return documents;
  const candidates=documents.filter(d=>isProcurement(d)&&text(d.documentNumber));
  if(!candidates.length)return documents;
  const scope=await serverScopeFromConnection(connection);
  if(!scope)return documents;
  const linkedByNumber=new Map();
  const numbers=[...new Set(candidates.map(d=>text(d.documentNumber)))];
  // Bound queries, no cross-server data, no N+1 D1 queries.
  for(let i=0;i<numbers.length;i+=80){
    const batch=numbers.slice(i,i+80);
    const sql="SELECT iiko_document_number,lines_json FROM procurement_receipts WHERE server_scope=?1 AND iiko_document_number IN ("+
      batch.map((_,j)=>"?"+(j+2)).join(",")+")";
    try{
      const rows=await env.DB.prepare(sql).bind(scope,...batch).all();
      for(const row of rows.results||[])linkedByNumber.set(text(row.iiko_document_number),row);
    }catch(e){
      // The ordinary iiko invoice API must continue working before procurement
      // schema is installed; never fabricate packaging when it is unavailable.
      if(/no such table/i.test(String(e?.message||e)))return documents;
      throw e;
    }
  }
  return documents.map(d=>{
    const row=linkedByNumber.get(text(d.documentNumber));
    return row?applyLines(d,row):d;
  });
}
