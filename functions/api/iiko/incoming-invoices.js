function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
async function sha1(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest("SHA-1",data);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function auth(ip,port,login,password){const serverUrl=`http://${ip}:${port}`;const pass=await sha1(password);const r=await fetch(`${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${pass}`,{cache:"no-store"});const token=(await r.text()).trim();if(!r.ok||!token)throw new Error(`Ошибка авторизации SH Server: HTTP ${r.status}`);return{serverUrl,token};}
function xmlDecode(value){return String(value??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");}
function tag(block,name){const m=String(block||"").match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,`i`));return m?xmlDecode(m[1].trim()):"";}
function blocks(source,name){const out=[];const re=new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`,`gi`);let m;while((m=re.exec(String(source||""))))out.push(m[0]);return out;}
function number(v){const n=Number(String(v??"").replace(/\\s/g,"").replace(",","."));return Number.isFinite(n)?n:null;}
function parseItems(documentBlock){return blocks(documentBlock,"item").map((b,i)=>({num:tag(b,"num")||String(i+1),amount:number(tag(b,"amount")),actualAmount:number(tag(b,"actualAmount")),productId:tag(b,"product"),productArticle:tag(b,"productArticle"),supplierProduct:tag(b,"supplierProduct"),supplierProductArticle:tag(b,"supplierProductArticle"),amountUnit:tag(b,"amountUnit"),containerId:tag(b,"containerId"),price:number(tag(b,"price")),priceWithoutVat:number(tag(b,"priceWithoutVat")),sum:number(tag(b,"sum")),sumWithoutNds:number(tag(b,"sumWithoutNds"))??number(tag(b,"sumWithoutVat")),vatPercent:number(tag(b,"vatPercent")||tag(b,"ndsPercent")),vatSum:number(tag(b,"vatSum")),storeId:tag(b,"store")}));}
function parseDocuments(xml){
  const source=String(xml||"");
  let documentBlocks=blocks(source,"document");
  if(!documentBlocks.length)documentBlocks=blocks(source,"incomingInvoice");
  if(!documentBlocks.length)documentBlocks=blocks(source,"incomingInvoiceDocument");
  return documentBlocks.map((b,i)=>{
    const items=parseItems(b);
    const itemTotal=items.reduce((s,x)=>s+(x.sum||0),0);
    const vatTotal=items.reduce((s,x)=>s+(x.vatSum||0),0);
    const sum=number(tag(b,"sum"))??number(tag(b,"totalSum"))??number(tag(b,"amount"))??(itemTotal||null);
    return{id:tag(b,"id")||null,documentNumber:tag(b,"documentNumber")||tag(b,"number")||null,dateIncoming:tag(b,"dateIncoming")||tag(b,"date")||null,incomingDate:tag(b,"incomingDate")||null,invoice:tag(b,"invoice")||null,incomingDocumentNumber:tag(b,"incomingDocumentNumber")||null,transportInvoiceNumber:tag(b,"transportInvoiceNumber")||null,supplierId:tag(b,"supplier")||tag(b,"supplierId")||null,storeId:tag(b,"defaultStore")||tag(b,"store")||tag(b,"storeId")||null,dueDate:tag(b,"dueDate")||null,status:tag(b,"status")||null,comment:tag(b,"comment")||null,conception:tag(b,"conception")||null,employeeId:tag(b,"employeePassToAccount")||null,sum,vatSum:vatTotal||number(tag(b,"vatSum")),itemsCount:items.length,items,rawIndex:i};
  }).filter(d=>d.documentNumber||d.id||d.dateIncoming||d.itemsCount);
}
async function requestXml(serverUrl,path){const r=await fetch(`${serverUrl}${path}`,{cache:"no-store",headers:{Accept:"application/xml,text/xml,*/*"}});const text=await r.text();return{ok:r.ok,status:r.status,text};}
function dateFormats(value){const s=String(value||"").trim();if(/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(s))return[s];if(/^\\d{4}-\\d{2}-\\d{2}$/.test(s)){const[y,m,d]=s.split("-");return[`${y}-${m}-${d}`,`${d}.${m}.${y}`];}return[];}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}
export async function onRequestPost(context){
  try{
    const b=await context.request.json();
    const ip=String(b.ip||"").trim(),port=String(b.port||"").trim(),login=String(b.login||"").trim(),password=String(b.password||"");
    if(!ip||!port||!login||!password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль SH Server"},400);
    const fromFormats=dateFormats(b.from),toFormats=dateFormats(b.to);
    if(!fromFormats.length||!toFormats.length)return jsonResponse({success:false,message:"Укажите период в формате даты"},400);
    const{serverUrl,token}=await auth(ip,port,login,password);
    const attempts=[];
    const pairs=[];
    for(const from of fromFormats)for(const to of toFormats){const key=`${from}|${to}`;if(!pairs.some(x=>x.key===key))pairs.push({key,from,to});}
    for(const pair of pairs){
      const params=new URLSearchParams({key:token,from:pair.from,to:pair.to});
      const result=await requestXml(serverUrl,`/resto/api/documents/export/incomingInvoice?${params.toString()}`);
      attempts.push({from:pair.from,to:pair.to,status:result.status,ok:result.ok,length:result.text.length});
      if(!result.ok)continue;
      const documents=parseDocuments(result.text);
      if(documents.length)return jsonResponse({success:true,count:documents.length,from:pair.from,to:pair.to,requestedFrom:b.from,requestedTo:b.to,documents});
    }
    return jsonResponse({success:true,count:0,from:b.from,to:b.to,documents:[],attempts});
  }catch(e){return jsonResponse({success:false,message:e?.message||"Ошибка получения приходных накладных"},502);}
}
