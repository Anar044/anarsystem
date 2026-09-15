import { clean, getOlapFields, iikoJson } from './_lib/iiko-client.js';

function corsHeaders(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders()}});}
function num(v){if(typeof v==='number')return Number.isFinite(v)?v:0;const n=Number(String(v??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0;}
function norm(v){return clean(v).toLowerCase().replace(/[\s._()\-:/]+/g,'');}
function unique(list){return [...new Set(list.filter(Boolean))];}
function fieldObject(fields,candidates){
  for(const c of candidates){const q=norm(c);const x=fields.find(f=>norm(f?.name)===q||norm(f?.title)===q);if(x)return x;}
  for(const c of candidates){const q=norm(c);const x=fields.find(f=>norm(f?.name).includes(q)||norm(f?.title).includes(q));if(x)return x;}
  return null;
}
function fieldName(fields,candidates){return fieldObject(fields,candidates)?.name||null;}
function endDate(value){const d=new Date(`${value}T00:00:00`);d.setDate(d.getDate()+1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function rowObject(row,columns){if(!Array.isArray(row))return row&&typeof row==='object'?row:{};const out={};row.forEach((value,index)=>{const col=columns?.[index];const name=typeof col==='string'?col:col?.name||col?.field||col?.key||`col${index}`;out[name]=value;});return out;}
function extractRows(report){
  if(!report)return[];
  if(Array.isArray(report.data))return report.data.map(row=>rowObject(row,report.columns||report.columnNames||report.headers));
  if(Array.isArray(report.rows))return report.rows.map(row=>rowObject(row,report.columns||report.columnNames||report.headers));
  if(Array.isArray(report))return report.map(row=>rowObject(row,[]));
  return[];
}
async function query(connection,request){
  const result=await iikoJson(connection,'/resto/api/v2/reports/olap',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(request)});
  if(!result.ok){const detail=result.payload?.message||result.payload?.error||result.text||'';throw new Error(`SH OLAP HTTP ${result.status}${detail?`: ${String(detail).slice(0,1200)}`:''}`);}
  return{payload:result.payload,authCacheHit:result.auth?.cacheHit===true};
}
function buildFilters({fields,dateField,from,to,departmentField,departmentIds}){
  const filters={};
  filters[dateField]={filterType:'DateRange',periodType:'CUSTOM',from,to:endDate(to),includeLow:true,includeHigh:false};
  const deletedWithWriteoff=fieldName(fields,['DeletedWithWriteoff']);
  const orderDeleted=fieldName(fields,['OrderDeleted','Order.Deleted']);
  if(deletedWithWriteoff)filters[deletedWithWriteoff]={filterType:'ExcludeValues',values:['DELETED_WITHOUT_WRITEOFF']};
  if(orderDeleted)filters[orderDeleted]={filterType:'IncludeValues',values:['NOT_DELETED']};
  if(departmentField&&departmentIds.length)filters[departmentField]={filterType:'IncludeValues',values:departmentIds};
  return filters;
}
function parseUpsellProducts(value){
  const source=Array.isArray(value)?value:String(value??'').split(/[;,\n]+/);
  return unique(source.map(x=>clean(x)).filter(Boolean));
}
function normalizeProductName(value){return clean(value).toLowerCase().replace(/\s+/g,' ');}
function waiterKey(value){return clean(value)||'Без официанта';}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}

export async function onRequestPost(context){
  const requestId=crypto.randomUUID?.()||Date.now().toString(36);
  try{
    const body=await context.request.json();
    const connection={ip:clean(body.ip),port:clean(body.port),login:clean(body.login),password:String(body.password??'')};
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:'Заполните данные подключения SH Server',requestId},400);
    const from=clean(body.from).slice(0,10),to=clean(body.to||body.from).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return jsonResponse({success:false,message:'Укажите корректный период',requestId},400);
    if(from>to)return jsonResponse({success:false,message:'Дата начала больше даты окончания',requestId},400);
    const departmentIds=unique((Array.isArray(body.departmentIds)?body.departmentIds:[]).map(clean));
    const upsellProducts=parseUpsellProducts(body.upsellProducts);

    const metadata=await getOlapFields(connection,'SALES');
    const fields=metadata.fields||[];
    const dateField=fieldName(fields,['OpenDate.Typed','OpenDate']);
    const waiterField=fieldName(fields,['DishWaiterName','WaiterName','OrderWaiterName','Waiter.Name','OrderWaiter.Name','EmployeeName','Waiter']);
    const orderField=fieldName(fields,['UniqOrderId','OrderId','Order.Id','OrderNum','OrderNumber','Order.Number']);
    const dishField=fieldName(fields,['DishName','Product.Name','Dish','ProductName']);
    const revenueField=fieldName(fields,['DishDiscountSumInt','DishSumInt','Sales','DishDiscountSum']);
    const quantityField=fieldName(fields,['DishAmountInt','DishAmount','Quantity','DishQuantity']);
    const profitField=fieldName(fields,['ProductCostBase.Profit','Profit','DishProfit']);
    const departmentField=fieldName(fields,['Department.Id','DepartmentId','Department.ID']);
    const tipField=fieldName(fields,['TipsSum','TipSum','TipsSumInt','GratuitySum','Gratuity','DonationSum','DonationsSum','Tips','Tip']);

    const missing=[];
    if(!dateField)missing.push('дата продажи');
    if(!waiterField)missing.push('официант');
    if(!orderField)missing.push('заказ');
    if(!dishField)missing.push('блюдо');
    if(!revenueField)missing.push('выручка');
    if(!quantityField)missing.push('количество');
    if(missing.length)return jsonResponse({success:false,message:`Не найдены обязательные OLAP-поля: ${missing.join(', ')}`,requestId,availableFields:fields.map(f=>({name:f.name,title:f.title}))},502);
    if(departmentIds.length&&!departmentField)return jsonResponse({success:false,message:'Не найдено поле Department.Id — нельзя безопасно ограничить отчёт выбранным рестораном',requestId},502);

    const filters=buildFilters({fields,dateField,from,to,departmentField,departmentIds});
    const aggregateFields=unique([revenueField,quantityField,profitField]);
    const detailRequest={reportType:'SALES',buildSummary:false,groupByRowFields:unique([waiterField,orderField,dishField]),groupByColFields:[],aggregateFields,filters};
    const detail=await query(connection,detailRequest);
    const rawRows=extractRows(detail.payload);

    const detailRows=rawRows.map((raw,index)=>({
      waiter:waiterKey(raw[waiterField]),
      orderId:clean(raw[orderField])||`unknown-${index}`,
      dish:clean(raw[dishField])||'Без названия',
      revenue:num(raw[revenueField]),
      quantity:num(raw[quantityField]),
      profit:profitField?num(raw[profitField]):0
    })).filter(row=>row.revenue!==0||row.quantity!==0||row.profit!==0);

    const totalRevenue=detailRows.reduce((s,r)=>s+r.revenue,0);
    const totalQuantity=detailRows.reduce((s,r)=>s+r.quantity,0);
    const totalProfit=detailRows.reduce((s,r)=>s+r.profit,0);
    const autoMarginThreshold=totalQuantity?totalProfit/totalQuantity:0;
    const configuredSet=new Set(upsellProducts.map(normalizeProductName));
    const upsellMode=configuredSet.size?'configured':'high_margin_auto';

    const map=new Map();
    for(const row of detailRows){
      const key=row.waiter;
      if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:new Set(),upsellQuantity:0,upsellRevenue:0,tips:null});
      const item=map.get(key);
      item.revenue+=row.revenue;
      item.quantity+=row.quantity;
      item.profit+=row.profit;
      item.orders.add(row.orderId);
      const isConfigured=configuredSet.size&&configuredSet.has(normalizeProductName(row.dish));
      const unitProfit=row.quantity?row.profit/row.quantity:0;
      const isAuto=!configuredSet.size&&profitField&&row.quantity>0&&unitProfit>=autoMarginThreshold;
      if(isConfigured||isAuto){item.upsellQuantity+=row.quantity;item.upsellRevenue+=row.revenue;}
    }

    let tipsAvailable=false;
    let tipsMessage='Поле чаевых не найдено в SALES OLAP этого сервера.';
    let tipsAuthCacheHit=false;
    if(tipField){
      try{
        const tipsRequest={reportType:'SALES',buildSummary:false,groupByRowFields:[waiterField],groupByColFields:[],aggregateFields:[tipField],filters};
        const tipsResult=await query(connection,tipsRequest);
        tipsAuthCacheHit=tipsResult.authCacheHit;
        const tipsRows=extractRows(tipsResult.payload);
        for(const raw of tipsRows){
          const key=waiterKey(raw[waiterField]);
          if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:new Set(),upsellQuantity:0,upsellRevenue:0,tips:0});
          map.get(key).tips=num(raw[tipField]);
        }
        tipsAvailable=true;
        tipsMessage='Чаевые получены из OLAP.';
      }catch(error){
        tipsMessage=`Поле чаевых найдено, но сервер не принял агрегирование: ${error?.message||'ошибка OLAP'}`;
      }
    }

    const totalOrders=new Set(detailRows.map(r=>`${r.waiter}¦${r.orderId}`)).size;
    const waiters=[...map.values()].map(item=>{
      const orders=item.orders.size;
      const averageCheck=orders?item.revenue/orders:0;
      const checkDepth=orders?item.quantity/orders:0;
      const marginPct=item.revenue?item.profit/item.revenue*100:0;
      const upsellPerOrder=orders?item.upsellQuantity/orders:0;
      const revenueShare=totalRevenue?item.revenue/totalRevenue*100:0;
      const tips=tipsAvailable?num(item.tips):null;
      const tipsPerOrder=tipsAvailable&&orders?tips/orders:null;
      return{waiter:item.waiter,revenue:item.revenue,revenueShare,orders,averageCheck,quantity:item.quantity,checkDepth,profit:item.profit,marginPct,upsellQuantity:item.upsellQuantity,upsellRevenue:item.upsellRevenue,upsellPerOrder,tips,tipsPerOrder};
    }).sort((a,b)=>b.revenue-a.revenue).map((row,index)=>({...row,rank:index+1}));

    const totalTips=tipsAvailable?waiters.reduce((s,r)=>s+num(r.tips),0):null;
    const averageCheck=totalOrders?totalRevenue/totalOrders:0;
    const checkDepth=totalOrders?totalQuantity/totalOrders:0;
    const averageRevenuePerWaiter=waiters.length?totalRevenue/waiters.length:0;

    return jsonResponse({
      success:true,requestId,from,to,waiters,
      summary:{waiters:waiters.length,orders:totalOrders,revenue:totalRevenue,quantity:totalQuantity,profit:totalProfit,averageCheck,checkDepth,averageRevenuePerWaiter,totalTips},
      upsell:{mode:upsellMode,configuredProducts:upsellProducts,autoMarginThreshold,profitAvailable:Boolean(profitField)},
      tips:{available:tipsAvailable,message:tipsMessage,field:tipField},
      fields:{dateField,waiterField,orderField,dishField,revenueField,quantityField,profitField,departmentField,tipField},
      meta:{departmentIds,departmentScopeApplied:departmentIds.length>0,olapFieldsCacheHit:metadata.cacheHit===true,authCacheHit:detail.authCacheHit,tipsAuthCacheHit}
    });
  }catch(error){
    console.error(`[WAITER-PERFORMANCE][${requestId}]`,error);
    return jsonResponse({success:false,message:error?.message||'Ошибка отчёта по официантам',requestId},502);
  }
}
