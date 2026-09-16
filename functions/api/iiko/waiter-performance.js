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
function candidateNames(fields,candidates){
  const out=[];
  for(const c of candidates){const q=norm(c);for(const f of fields){if((norm(f?.name)===q||norm(f?.title)===q)&&f?.name&&!out.includes(f.name))out.push(f.name);}}
  for(const c of candidates){const q=norm(c);for(const f of fields){if((norm(f?.name).includes(q)||norm(f?.title).includes(q))&&f?.name&&!out.includes(f.name))out.push(f.name);}}
  return out;
}
function parseDate(value){return new Date(`${value}T00:00:00Z`);}
function dateString(date){return date.toISOString().slice(0,10);}
function shiftDate(value,days){const d=parseDate(value);d.setUTCDate(d.getUTCDate()+days);return dateString(d);}
function inclusiveDays(from,to){return Math.max(1,Math.round((parseDate(to)-parseDate(from))/86400000)+1);}
function previousPeriod(from,to){const days=inclusiveDays(from,to);const previousTo=shiftDate(from,-1);return{from:shiftDate(previousTo,-days+1),to:previousTo,days};}
function endDate(value){return shiftDate(value,1);}
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
function isGroupingError(error){return /grouping\s+is\s+not\s+allowed|grouping.*not.*allowed|illegalargumentexception/i.test(String(error?.message||error||''));}
function deltaPercent(current,previous){current=num(current);previous=num(previous);if(previous===0)return current===0?0:null;return(current-previous)/Math.abs(previous)*100;}

async function loadOrderCounts({connection,fields,waiterField,dateField,revenueField,filters}){
  const orderCountField=fieldName(fields,['UniqOrderId','UniqueOrderCount','UniqOrderCount','OrderCount','OrdersCount','OrderCountInt']);
  if(orderCountField){
    try{
      const request={reportType:'SALES',buildSummary:false,groupByRowFields:[waiterField],groupByColFields:[],aggregateFields:[orderCountField],filters};
      const result=await query(connection,request);
      const counts=new Map();
      for(const raw of extractRows(result.payload))counts.set(waiterKey(raw[waiterField]),Math.max(0,num(raw[orderCountField])));
      return{counts,field:orderCountField,mode:'unique_order_measure',authCacheHit:result.authCacheHit};
    }catch(error){
      console.warn('[WAITER-PERFORMANCE] unique order measure failed',orderCountField,error?.message||error);
    }
  }

  const dimensions=candidateNames(fields,['OrderNum','OrderNumber','Order.Number','OrderId','Order.Id']).filter(name=>norm(name)!==norm(orderCountField));
  let lastError=null;
  for(const orderField of dimensions){
    for(const withDate of [true,false]){
      try{
        const rows=unique([waiterField,withDate?dateField:null,orderField]);
        const request={reportType:'SALES',buildSummary:false,groupByRowFields:rows,groupByColFields:[],aggregateFields:[revenueField],filters};
        const result=await query(connection,request);
        const counts=new Map();
        for(const raw of extractRows(result.payload)){
          const key=waiterKey(raw[waiterField]);
          counts.set(key,(counts.get(key)||0)+1);
        }
        return{counts,field:orderField,mode:withDate?'order_dimension_with_date':'order_dimension',authCacheHit:result.authCacheHit};
      }catch(error){
        lastError=error;
        if(!isGroupingError(error))break;
      }
    }
  }
  throw new Error(`Не удалось определить количество заказов по официантам${lastError?`: ${lastError.message}`:''}`);
}

async function loadPeriodByWaiter({connection,fields,waiterField,dateField,revenueField,quantityField,profitField,departmentField,departmentIds,from,to,orderCountHint}){
  const filters=buildFilters({fields,dateField,from,to,departmentField,departmentIds});
  const measures=unique([revenueField,quantityField,profitField,orderCountHint?.mode==='unique_order_measure'?orderCountHint.field:null]);
  const result=await query(connection,{reportType:'SALES',buildSummary:false,groupByRowFields:[waiterField],groupByColFields:[],aggregateFields:measures,filters});
  const map=new Map();
  for(const raw of extractRows(result.payload)){
    const key=waiterKey(raw[waiterField]);
    map.set(key,{waiter:key,revenue:num(raw[revenueField]),quantity:num(raw[quantityField]),profit:profitField?num(raw[profitField]):0,orders:orderCountHint?.mode==='unique_order_measure'?Math.max(0,num(raw[orderCountHint.field])):0});
  }
  if(orderCountHint?.mode!=='unique_order_measure'){
    const counts=await loadOrderCounts({connection,fields,waiterField,dateField,revenueField,filters});
    for(const [key,count] of counts.counts){
      if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:0});
      map.get(key).orders=Math.max(0,num(count));
    }
  }
  const rows=[...map.values()].map(item=>({
    ...item,
    averageCheck:item.orders?item.revenue/item.orders:0,
    checkDepth:item.orders?item.quantity/item.orders:0,
    marginPct:item.revenue?item.profit/item.revenue*100:0
  }));
  return{rows,map:new Map(rows.map(row=>[row.waiter,row])),authCacheHit:result.authCacheHit};
}

async function loadDaily({connection,fields,waiterField,dateField,revenueField,quantityField,profitField,departmentField,departmentIds,from,to,orderCountHint}){
  const filters=buildFilters({fields,dateField,from,to,departmentField,departmentIds});
  if(orderCountHint?.mode==='unique_order_measure'){
    const measures=unique([revenueField,quantityField,profitField,orderCountHint.field]);
    const result=await query(connection,{reportType:'SALES',buildSummary:false,groupByRowFields:[dateField,waiterField],groupByColFields:[],aggregateFields:measures,filters});
    const byDate=new Map();
    for(const raw of extractRows(result.payload)){
      const date=clean(raw[dateField]).slice(0,10);if(!date)continue;
      if(!byDate.has(date))byDate.set(date,{date,revenue:0,quantity:0,profit:0,orders:0});
      const row=byDate.get(date);row.revenue+=num(raw[revenueField]);row.quantity+=num(raw[quantityField]);row.profit+=profitField?num(raw[profitField]):0;row.orders+=Math.max(0,num(raw[orderCountHint.field]));
    }
    return[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,averageCheck:row.orders?row.revenue/row.orders:0,checkDepth:row.orders?row.quantity/row.orders:0}));
  }

  const dimension=orderCountHint?.field;
  if(!dimension)return[];
  try{
    const result=await query(connection,{reportType:'SALES',buildSummary:false,groupByRowFields:unique([dateField,waiterField,dimension]),groupByColFields:[],aggregateFields:unique([revenueField,quantityField,profitField]),filters});
    const byDate=new Map();
    for(const raw of extractRows(result.payload)){
      const date=clean(raw[dateField]).slice(0,10);if(!date)continue;
      if(!byDate.has(date))byDate.set(date,{date,revenue:0,quantity:0,profit:0,orderKeys:new Set()});
      const row=byDate.get(date);row.revenue+=num(raw[revenueField]);row.quantity+=num(raw[quantityField]);row.profit+=profitField?num(raw[profitField]):0;row.orderKeys.add(`${waiterKey(raw[waiterField])}¦${clean(raw[dimension])}`);
    }
    return[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>{const orders=row.orderKeys.size;return{date:row.date,revenue:row.revenue,quantity:row.quantity,profit:row.profit,orders,averageCheck:orders?row.revenue/orders:0,checkDepth:orders?row.quantity/orders:0};});
  }catch(error){
    console.warn('[WAITER-PERFORMANCE] daily dynamics unavailable',error?.message||error);
    return[];
  }
}

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
    const dishField=fieldName(fields,['DishName','Product.Name','Dish','ProductName']);
    const revenueField=fieldName(fields,['DishDiscountSumInt','DishSumInt','Sales','DishDiscountSum']);
    const quantityField=fieldName(fields,['DishAmountInt','DishAmount','Quantity','DishQuantity']);
    const profitField=fieldName(fields,['ProductCostBase.Profit','Profit','DishProfit']);
    const departmentField=fieldName(fields,['Department.Id','DepartmentId','Department.ID']);
    const tipField=fieldName(fields,['TipsSum','TipSum','TipsSumInt','GratuitySum','Gratuity','DonationSum','DonationsSum','Tips','Tip']);

    const missing=[];
    if(!dateField)missing.push('дата продажи');
    if(!waiterField)missing.push('официант');
    if(!dishField)missing.push('блюдо');
    if(!revenueField)missing.push('выручка');
    if(!quantityField)missing.push('количество');
    if(missing.length)return jsonResponse({success:false,message:`Не найдены обязательные OLAP-поля: ${missing.join(', ')}`,requestId,availableFields:fields.map(f=>({name:f.name,title:f.title}))},502);
    if(departmentIds.length&&!departmentField)return jsonResponse({success:false,message:'Не найдено поле Department.Id — нельзя безопасно ограничить отчёт выбранным рестораном',requestId},502);

    const filters=buildFilters({fields,dateField,from,to,departmentField,departmentIds});
    const aggregateFields=unique([revenueField,quantityField,profitField]);
    const detailRequest={reportType:'SALES',buildSummary:false,groupByRowFields:unique([waiterField,dishField]),groupByColFields:[],aggregateFields,filters};
    const detail=await query(connection,detailRequest);
    const rawRows=extractRows(detail.payload);

    const detailRows=rawRows.map(raw=>({
      waiter:waiterKey(raw[waiterField]),
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
      if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:0,upsellQuantity:0,upsellRevenue:0,tips:null});
      const item=map.get(key);
      item.revenue+=row.revenue;
      item.quantity+=row.quantity;
      item.profit+=row.profit;
      const isConfigured=configuredSet.size&&configuredSet.has(normalizeProductName(row.dish));
      const unitProfit=row.quantity?row.profit/row.quantity:0;
      const isAuto=!configuredSet.size&&profitField&&row.quantity>0&&unitProfit>=autoMarginThreshold;
      if(isConfigured||isAuto){item.upsellQuantity+=row.quantity;item.upsellRevenue+=row.revenue;}
    }

    const orderCounts=await loadOrderCounts({connection,fields,waiterField,dateField,revenueField,filters});
    for(const [key,count] of orderCounts.counts){
      if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:0,upsellQuantity:0,upsellRevenue:0,tips:null});
      map.get(key).orders=Math.max(0,num(count));
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
          if(!map.has(key))map.set(key,{waiter:key,revenue:0,quantity:0,profit:0,orders:0,upsellQuantity:0,upsellRevenue:0,tips:0});
          map.get(key).tips=num(raw[tipField]);
        }
        tipsAvailable=true;
        tipsMessage='Чаевые получены из OLAP.';
      }catch(error){
        tipsMessage=`Поле чаевых найдено, но сервер не принял агрегирование: ${error?.message||'ошибка OLAP'}`;
      }
    }

    const totalOrders=[...map.values()].reduce((s,item)=>s+Math.max(0,num(item.orders)),0);
    let waiters=[...map.values()].map(item=>{
      const orders=Math.max(0,num(item.orders));
      const averageCheck=orders?item.revenue/orders:0;
      const checkDepth=orders?item.quantity/orders:0;
      const marginPct=item.revenue?item.profit/item.revenue*100:0;
      const upsellPerOrder=orders?item.upsellQuantity/orders:0;
      const revenueShare=totalRevenue?item.revenue/totalRevenue*100:0;
      const tips=tipsAvailable?num(item.tips):null;
      const tipsPerOrder=tipsAvailable&&orders?tips/orders:null;
      return{waiter:item.waiter,revenue:item.revenue,revenueShare,orders,averageCheck,quantity:item.quantity,checkDepth,profit:item.profit,marginPct,upsellQuantity:item.upsellQuantity,upsellRevenue:item.upsellRevenue,upsellPerOrder,tips,tipsPerOrder};
    }).filter(row=>row.revenue!==0||row.quantity!==0||row.orders!==0||num(row.tips)!==0).sort((a,b)=>b.revenue-a.revenue);

    const comparisonPeriod=previousPeriod(from,to);
    let comparison={available:false,period:{from:comparisonPeriod.from,to:comparisonPeriod.to},summary:null};
    try{
      const previous=await loadPeriodByWaiter({connection,fields,waiterField,dateField,revenueField,quantityField,profitField,departmentField,departmentIds,from:comparisonPeriod.from,to:comparisonPeriod.to,orderCountHint:orderCounts});
      const prevRevenue=previous.rows.reduce((s,r)=>s+r.revenue,0);
      const prevQuantity=previous.rows.reduce((s,r)=>s+r.quantity,0);
      const prevProfit=previous.rows.reduce((s,r)=>s+r.profit,0);
      const prevOrders=previous.rows.reduce((s,r)=>s+r.orders,0);
      const prevAverageCheck=prevOrders?prevRevenue/prevOrders:0;
      const prevCheckDepth=prevOrders?prevQuantity/prevOrders:0;
      comparison={
        available:true,
        period:{from:comparisonPeriod.from,to:comparisonPeriod.to},
        summary:{
          revenue:prevRevenue,orders:prevOrders,quantity:prevQuantity,profit:prevProfit,averageCheck:prevAverageCheck,checkDepth:prevCheckDepth,
          revenueDeltaPct:deltaPercent(totalRevenue,prevRevenue),ordersDeltaPct:deltaPercent(totalOrders,prevOrders),averageCheckDeltaPct:deltaPercent(totalOrders?totalRevenue/totalOrders:0,prevAverageCheck),checkDepthDeltaPct:deltaPercent(totalOrders?totalQuantity/totalOrders:0,prevCheckDepth),profitDeltaPct:deltaPercent(totalProfit,prevProfit)
        }
      };
      waiters=waiters.map(row=>{
        const prev=previous.map.get(row.waiter)||{revenue:0,orders:0,averageCheck:0,checkDepth:0,profit:0};
        return{...row,previous:{revenue:prev.revenue,orders:prev.orders,averageCheck:prev.averageCheck,checkDepth:prev.checkDepth,profit:prev.profit},delta:{revenuePct:deltaPercent(row.revenue,prev.revenue),ordersPct:deltaPercent(row.orders,prev.orders),averageCheckPct:deltaPercent(row.averageCheck,prev.averageCheck),checkDepthPct:deltaPercent(row.checkDepth,prev.checkDepth),profitPct:deltaPercent(row.profit,prev.profit)}};
      });
    }catch(error){
      console.warn('[WAITER-PERFORMANCE] previous period unavailable',error?.message||error);
      comparison.message=error?.message||'Не удалось получить предыдущий период';
    }

    waiters=waiters.map((row,index)=>({...row,rank:index+1}));
    const totalTips=tipsAvailable?waiters.reduce((s,r)=>s+num(r.tips),0):null;
    const averageCheck=totalOrders?totalRevenue/totalOrders:0;
    const checkDepth=totalOrders?totalQuantity/totalOrders:0;
    const averageRevenuePerWaiter=waiters.length?totalRevenue/waiters.length:0;
    const daily=await loadDaily({connection,fields,waiterField,dateField,revenueField,quantityField,profitField,departmentField,departmentIds,from,to,orderCountHint:orderCounts});

    return jsonResponse({
      success:true,requestId,from,to,waiters,daily,comparison,
      summary:{waiters:waiters.length,orders:totalOrders,revenue:totalRevenue,quantity:totalQuantity,profit:totalProfit,averageCheck,checkDepth,averageRevenuePerWaiter,totalTips},
      upsell:{mode:upsellMode,configuredProducts:upsellProducts,autoMarginThreshold,profitAvailable:Boolean(profitField)},
      tips:{available:tipsAvailable,message:tipsMessage,field:tipField},
      fields:{dateField,waiterField,dishField,revenueField,quantityField,profitField,departmentField,tipField,orderCountField:orderCounts.field,orderCountMode:orderCounts.mode},
      meta:{departmentIds,departmentScopeApplied:departmentIds.length>0,olapFieldsCacheHit:metadata.cacheHit===true,authCacheHit:detail.authCacheHit,orderCountAuthCacheHit:orderCounts.authCacheHit,tipsAuthCacheHit}
    });
  }catch(error){
    console.error(`[WAITER-PERFORMANCE][${requestId}]`,error);
    return jsonResponse({success:false,message:error?.message||'Ошибка отчёта по официантам',requestId},502);
  }
}
