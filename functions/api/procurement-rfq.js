const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const clean=v=>String(v??"").trim();
const n=(v,f=0)=>{const x=Number(v);return Number.isFinite(x)?x:f};
const money=v=>Math.round(n(v)*10000)/10000;
const parse=(v,f)=>{try{return JSON.parse(String(v||""))}catch{return f}};
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();

async function tokenHash(value){
  const data=new TextEncoder().encode(clean(value));
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",data));
  return [...digest].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function ensure(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_rfqs (
      id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,requisition_id TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',
      deadline TEXT NOT NULL DEFAULT '',message TEXT NOT NULL DEFAULT '',supplier_ids_json TEXT NOT NULL DEFAULT '[]',supplier_names_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',created_by_name TEXT NOT NULL DEFAULT '',sent_at TEXT NOT NULL DEFAULT '',closed_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_rfq_suppliers (
      id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,rfq_id TEXT NOT NULL,supplier_id TEXT NOT NULL,supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',token_hash TEXT NOT NULL DEFAULT '',token_created_at TEXT NOT NULL DEFAULT '',token_expires_at TEXT NOT NULL DEFAULT '',responded_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_rfq_supplier_unique ON procurement_rfq_suppliers(rfq_id,supplier_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_requisitions (
      id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'MANUAL',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL,created_by_name TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL DEFAULT '',
      restaurant_ids_json TEXT NOT NULL DEFAULT '[]',restaurant_names_json TEXT NOT NULL DEFAULT '[]',warehouse_id TEXT NOT NULL,warehouse_name TEXT NOT NULL DEFAULT '',
      needed_by TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',total_estimate REAL NOT NULL DEFAULT 0,required_approval_level TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',approved_by_name TEXT NOT NULL DEFAULT '',approved_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_requisition_lines (
      id TEXT PRIMARY KEY,requisition_id TEXT NOT NULL,product_id TEXT NOT NULL,product_name TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,package_size REAL NOT NULL DEFAULT 1,package_count REAL NOT NULL DEFAULT 0,container_id TEXT NOT NULL DEFAULT '',
      package_name TEXT NOT NULL DEFAULT '',vat_percent REAL NOT NULL DEFAULT 0,expected_price REAL NOT NULL DEFAULT 0,current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL,max_stock REAL,store_id TEXT NOT NULL DEFAULT '',store_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_quotes (
      id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,requisition_id TEXT NOT NULL,rfq_id TEXT NOT NULL DEFAULT '',supplier_id TEXT NOT NULL,supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OFFERED',currency TEXT NOT NULL DEFAULT 'AZN',delivery_days INTEGER NOT NULL DEFAULT 0,payment_terms TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',lines_json TEXT NOT NULL DEFAULT '[]',total_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',created_by_name TEXT NOT NULL DEFAULT ''
    )`)
  ]);
  const info=await db.prepare("PRAGMA table_info(procurement_quotes)").all();
  if(!(info.results||[]).some(x=>String(x.name||"")==="rfq_id"))await db.prepare("ALTER TABLE procurement_quotes ADD COLUMN rfq_id TEXT NOT NULL DEFAULT ''").run();
}
async function accessByToken(db,raw){
  const token=clean(raw);if(!token)return{error:"Ссылка RFQ не указана.",status:400};
  const hash=await tokenHash(token);
  const s=await db.prepare(`SELECT s.*,q.number AS rfq_number,q.status AS rfq_status,q.deadline,q.message,q.requisition_id,
    r.number AS pr_number,r.warehouse_name,r.status AS pr_status
    FROM procurement_rfq_suppliers s
    JOIN procurement_rfqs q ON q.id=s.rfq_id
    JOIN procurement_requisitions r ON r.id=q.requisition_id
    WHERE s.token_hash=?1 LIMIT 1`).bind(hash).first();
  if(!s)return{error:"Ссылка RFQ недействительна или была заменена.",status:404};
  if(s.token_expires_at&&new Date(s.token_expires_at).getTime()<Date.now())return{error:"Срок действия ссылки RFQ истёк.",status:410};
  if(String(s.rfq_status).toUpperCase()==="CLOSED")return{error:"Этот запрос цен уже закрыт.",status:410};
  if(s.deadline&&s.deadline<new Date().toISOString().slice(0,10))return{error:"Срок ответа по RFQ уже истёк.",status:410};
  return{row:s};
}
function publicLine(x){
  return{
    productId:x.product_id,productName:x.product_name,unit:x.unit,quantity:n(x.quantity),
    packageSize:n(x.package_size,1)||1,packageCount:n(x.package_count)||n(x.quantity),
    packageName:x.package_name||"",vatPercent:n(x.vat_percent)
  };
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS})}

export async function onRequestGet({request,env}){
  try{
    await ensure(env.DB);
    const token=new URL(request.url).searchParams.get("token")||"";
    const a=await accessByToken(env.DB,token);if(a.error)return json({success:false,message:a.error},a.status);
    const s=a.row;
    const linesR=await env.DB.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1 ORDER BY rowid").bind(s.requisition_id).all();
    const existing=await env.DB.prepare("SELECT * FROM procurement_quotes WHERE rfq_id=?1 AND supplier_id=?2 ORDER BY created_at DESC LIMIT 1").bind(s.rfq_id,s.supplier_id).first();
    return json({
      success:true,
      rfq:{
        number:s.rfq_number,prNumber:s.pr_number,status:s.rfq_status,deadline:s.deadline,message:s.message,
        supplierId:s.supplier_id,supplierName:s.supplier_name,warehouseName:s.warehouse_name||"",
        responseStatus:s.status,respondedAt:s.responded_at||"",
        lines:(linesR.results||[]).map(publicLine),
        existing:existing?{
          deliveryDays:n(existing.delivery_days),paymentTerms:existing.payment_terms||"",validUntil:existing.valid_until||"",
          comment:existing.comment||"",currency:existing.currency||"AZN",lines:parse(existing.lines_json,[])
        }:null
      }
    });
  }catch(error){
    console.error("[PROCUREMENT-RFQ:GET]",error);
    return json({success:false,message:error?.message||String(error)},500);
  }
}

export async function onRequestPost({request,env}){
  try{
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),token=clean(body?.token);
    const a=await accessByToken(env.DB,token);if(a.error)return json({success:false,message:a.error},a.status);
    const s=a.row;
    const reqR=await env.DB.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1 ORDER BY rowid").bind(s.requisition_id).all();
    const reqLines=reqR.results||[],byId=new Map(reqLines.map(x=>[clean(x.product_id),x]));
    const offered=Array.isArray(body?.lines)?body.lines:[],lines=[];
    for(const raw of offered){
      const productId=clean(raw?.productId),price=money(raw?.unitPrice);
      if(!productId||!(price>0))continue;
      const req=byId.get(productId);if(!req)continue;
      const packageCount=n(req.package_count)||n(req.quantity)/(n(req.package_size,1)||1);
      lines.push({
        productId,productName:req.product_name,unit:req.unit,quantity:n(req.quantity),
        packageSize:n(req.package_size,1)||1,packageCount,containerId:req.container_id||"",packageName:req.package_name||"",
        vatPercent:n(req.vat_percent),unitPrice:price,total:money(packageCount*price)
      });
    }
    if(!lines.length)return json({success:false,message:"Укажите цену хотя бы для одной позиции."},400);
    const total=money(lines.reduce((sum,x)=>sum+x.total,0)),stamp=now();
    const deliveryDays=Math.max(0,Math.round(n(body?.deliveryDays))),paymentTerms=clean(body?.paymentTerms),
      validUntil=clean(body?.validUntil),comment=clean(body?.comment),currency=clean(body?.currency||"AZN")||"AZN";
    const existing=await env.DB.prepare("SELECT * FROM procurement_quotes WHERE rfq_id=?1 AND supplier_id=?2 ORDER BY created_at DESC LIMIT 1").bind(s.rfq_id,s.supplier_id).first();
    let quoteId=existing?.id||uid();
    if(existing?.status==="SELECTED")return json({success:false,message:"По этому предложению уже создан PO. Изменение заблокировано."},409);
    if(existing){
      await env.DB.prepare(`UPDATE procurement_quotes SET status='OFFERED',currency=?2,delivery_days=?3,payment_terms=?4,valid_until=?5,comment=?6,lines_json=?7,total_amount=?8,created_at=?9,created_by='SUPPLIER_LINK',created_by_name=?10 WHERE id=?1`)
        .bind(existing.id,currency,deliveryDays,paymentTerms,validUntil,comment,JSON.stringify(lines),total,stamp,s.supplier_name).run();
    }else{
      await env.DB.prepare(`INSERT INTO procurement_quotes(id,server_scope,requisition_id,rfq_id,supplier_id,supplier_name,status,currency,delivery_days,payment_terms,valid_until,comment,lines_json,total_amount,created_at,created_by,created_by_name)
        VALUES(?1,?2,?3,?4,?5,?6,'OFFERED',?7,?8,?9,?10,?11,?12,?13,?14,'SUPPLIER_LINK',?15)`)
        .bind(quoteId,s.server_scope,s.requisition_id,s.rfq_id,s.supplier_id,s.supplier_name,currency,deliveryDays,paymentTerms,validUntil,comment,JSON.stringify(lines),total,stamp,s.supplier_name).run();
    }
    await env.DB.prepare("UPDATE procurement_rfq_suppliers SET status='RESPONDED',responded_at=?2 WHERE id=?1").bind(s.id,stamp).run();
    return json({success:true,quoteId,totalAmount:total,respondedAt:stamp});
  }catch(error){
    console.error("[PROCUREMENT-RFQ:POST]",error);
    return json({success:false,message:error?.message||String(error)},500);
  }
}
