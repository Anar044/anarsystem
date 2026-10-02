(()=>{
'use strict';
const $=id=>document.getElementById(id);
let conversations=[],currentId='',busy=false,currentMessages=[];
let mediaRecorder=null,mediaStream=null,audioChunks=[],recordStarted=0,recordTicker=null,recordStopTimer=null,currentAudio=null,currentAudioUrl='';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw Error('Supabase Auth не готов');const r=await c.auth.getSession();const t=r.data?.session?.access_token;if(r.error||!t)throw Error('Сессия пользователя не найдена');return t}
async function get(q){const t=await token(),r=await fetch('/api/ai-assistant'+q,{headers:{Authorization:'Bearer '+t},cache:'no-store'}),j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));return j}
async function post(body){
  const t=await token();
  let payload={...body};
  if(body?.action==='message'&&window.SH_IikoContext?.getBinding){
    try{
      const binding=await window.SH_IikoContext.getBinding();
      payload.departmentIds=Array.isArray(binding?.departmentIds)?binding.departmentIds:[];
    }catch(_){}
  }
  const r=await fetch('/api/ai-assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.success){const e=Error(j.message||('HTTP '+r.status));e.code=j.code||'';throw e}
  return j
}
function fmt(v){try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return''}}


function chartNumber(value){
  const n=Number(value);
  return Number.isFinite(n)?n:0;
}
function chartValue(value){
  const n=chartNumber(value);
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
}
function chartCard(chart){
  if(!chart||typeof chart!=='object')return'';
  const type=['bar','horizontal_bar','line','pie'].includes(chart.type)?chart.type:'bar';
  const series=Array.isArray(chart.series)?chart.series.filter(s=>Array.isArray(s?.data)&&s.data.length):[];
  if(!series.length)return'';
  const notes=Array.isArray(chart.notes)?chart.notes:[];
  const legend=series.length>1?'<div class="sha-chart-legend">'+series.map((s,i)=>'<span><i class="sha-chart-dot s'+(i%6)+'"></i>'+esc(s.name||('Серия '+(i+1)))+'</span>').join('')+'</div>':'';

  let visual='';
  if(type==='horizontal_bar'){
    const labels=[...new Set(series.flatMap(s=>s.data.map(p=>String(p?.label??''))))];
    const max=Math.max(1,...series.flatMap(s=>s.data.map(p=>Math.abs(chartNumber(p?.value)))));
    visual='<div class="sha-hbar">'+labels.map(label=>{
      const bars=series.map((s,i)=>{
        const point=s.data.find(p=>String(p?.label??'')===label);
        const value=chartNumber(point?.value);
        const width=Math.max(1,Math.abs(value)/max*100);
        return '<div class="sha-hbar-line"><div class="sha-hbar-track"><span class="sha-hbar-fill s'+(i%6)+'" style="width:'+width.toFixed(2)+'%"></span></div><strong>'+esc(chartValue(value))+'</strong></div>';
      }).join('');
      return '<div class="sha-hbar-row"><div class="sha-hbar-label">'+esc(label)+'</div><div class="sha-hbar-bars">'+bars+'</div></div>';
    }).join('')+'</div>';
  }else if(type==='pie'){
    const data=series[0].data.slice(0,12);
    const total=data.reduce((sum,p)=>sum+Math.max(0,chartNumber(p?.value)),0)||1;
    let cursor=0;
    const stops=data.map((p,i)=>{
      const value=Math.max(0,chartNumber(p?.value));
      const start=cursor;
      cursor+=value/total*100;
      return 'var(--chart-s'+(i%6)+') '+start.toFixed(3)+'% '+cursor.toFixed(3)+'%';
    }).join(',');
    visual='<div class="sha-pie-layout"><div class="sha-pie" style="background:conic-gradient('+stops+')"></div><div class="sha-pie-list">'+data.map((p,i)=>{
      const value=Math.max(0,chartNumber(p?.value));
      const pct=value/total*100;
      return '<div><span><i class="sha-chart-dot s'+(i%6)+'"></i>'+esc(p?.label??'')+'</span><strong>'+esc(chartValue(value))+' · '+pct.toFixed(1)+'%</strong></div>';
    }).join('')+'</div></div>';
  }else{
    const labels=[...new Set(series.flatMap(s=>s.data.map(p=>String(p?.label??''))))];
    const values=series.flatMap(s=>s.data.map(p=>chartNumber(p?.value)));
    const max=Math.max(1,...values.map(v=>Math.abs(v)));
    const width=Math.max(620,labels.length*84);
    const height=280,padL=52,padR=20,padT=24,padB=58;
    const plotW=width-padL-padR,plotH=height-padT-padB;
    const y=v=>padT+plotH-(Math.max(0,v)/max*plotH);
    const x=i=>labels.length<=1?padL+plotW/2:padL+(i/(labels.length-1))*plotW;
    const grid=[0,.25,.5,.75,1].map(t=>{
      const gy=padT+plotH-(t*plotH);
      const val=max*t;
      return '<line x1="'+padL+'" y1="'+gy+'" x2="'+(width-padR)+'" y2="'+gy+'" class="sha-chart-grid"></line><text x="'+(padL-8)+'" y="'+(gy+4)+'" class="sha-chart-axis-label" text-anchor="end">'+esc(chartValue(val))+'</text>';
    }).join('');
    const xlabels=labels.map((label,i)=>'<text x="'+x(i)+'" y="'+(height-22)+'" class="sha-chart-axis-label" text-anchor="middle">'+esc(label.length>16?label.slice(0,15)+'…':label)+'</text>').join('');

    if(type==='line'){
      const lines=series.map((s,si)=>{
        const points=labels.map((label,i)=>{
          const p=s.data.find(item=>String(item?.label??'')===label);
          return [x(i),y(chartNumber(p?.value))];
        });
        const poly=points.map(p=>p[0]+','+p[1]).join(' ');
        const dots=points.map((p,i)=>{
          const point=s.data.find(item=>String(item?.label??'')===labels[i]);
          const value=chartNumber(point?.value);
          return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4" class="sha-chart-point s'+(si%6)+'"><title>'+esc(labels[i]+': '+chartValue(value))+'</title></circle>';
        }).join('');
        return '<polyline points="'+poly+'" class="sha-chart-line s'+(si%6)+'"></polyline>'+dots;
      }).join('');
      visual='<div class="sha-chart-scroll"><svg class="sha-chart-svg" viewBox="0 0 '+width+' '+height+'" role="img">'+grid+xlabels+lines+'</svg></div>';
    }else{
      const groupW=plotW/Math.max(1,labels.length);
      const gap=5;
      const barW=Math.max(7,Math.min(34,(groupW-18)/Math.max(1,series.length)-gap));
      const bars=labels.map((label,li)=>series.map((s,si)=>{
        const point=s.data.find(p=>String(p?.label??'')===label);
        const value=Math.max(0,chartNumber(point?.value));
        const h=value/max*plotH;
        const gx=padL+li*groupW+(groupW-(series.length*(barW+gap)-gap))/2+si*(barW+gap);
        return '<rect x="'+gx.toFixed(2)+'" y="'+(padT+plotH-h).toFixed(2)+'" width="'+barW.toFixed(2)+'" height="'+h.toFixed(2)+'" rx="4" class="sha-chart-bar s'+(si%6)+'"><title>'+esc(label+': '+chartValue(value))+'</title></rect>';
      }).join('')).join('');
      const bxlabels=labels.map((label,i)=>'<text x="'+(padL+i*groupW+groupW/2)+'" y="'+(height-22)+'" class="sha-chart-axis-label" text-anchor="middle">'+esc(label.length>14?label.slice(0,13)+'…':label)+'</text>').join('');
      visual='<div class="sha-chart-scroll"><svg class="sha-chart-svg" viewBox="0 0 '+width+' '+height+'" role="img">'+grid+bxlabels+bars+'</svg></div>';
    }
  }

  return '<section class="sha-chart-card"><div class="sha-chart-head"><div><span class="sha-report-eyebrow">SMART HORECA CHART</span><h3>'+esc(chart.title||'График')+'</h3>'+(chart.subtitle?'<p>'+esc(chart.subtitle)+'</p>':'')+'</div></div>'+legend+'<div class="sha-chart-body">'+visual+'</div>'+(chart.xLabel||chart.yLabel?'<div class="sha-chart-labels">'+(chart.xLabel?'<span>X: '+esc(chart.xLabel)+'</span>':'')+(chart.yLabel?'<span>Y: '+esc(chart.yLabel)+'</span>':'')+'</div>':'')+(notes.length?'<div class="sha-report-notes">'+notes.map(note=>'<div>'+esc(note)+'</div>').join('')+'</div>':'')+'</section>';
}


function excelSafeName(value){
  return String(value||'AI-report')
    .replace(/[\\/:*?"<>|]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,90)||'AI-report';
}
function excelNumeric(value){
  const text=String(value??'').trim();
  const normalized=text.replace(/\s/g,'').replace(/,/g,'.').replace(/[^0-9.+-]/g,'');
  if(!normalized)return null;
  const n=Number(normalized);
  return Number.isFinite(n)?n:null;
}
function excelArgb(hex){
  return 'FF'+String(hex||'').replace('#','').toUpperCase();
}
async function exportReportToExcel(report){
  if(!report||typeof report!=='object')throw Error('Отчёт для выгрузки не найден.');
  if(!window.ExcelJS)throw Error('Модуль Excel ещё не загрузился. Обновите страницу и попробуйте снова.');

  const columns=Array.isArray(report.columns)?report.columns:[];
  const rows=Array.isArray(report.rows)?report.rows:[];
  const totals=Array.isArray(report.totals)?report.totals:[];
  const kpis=Array.isArray(report.kpis)?report.kpis:[];
  const notes=Array.isArray(report.notes)?report.notes:[];
  if(!columns.length)throw Error('В этом ответе нет табличных данных для Excel.');

  const wb=new ExcelJS.Workbook();
  wb.creator='Smart Horeca';
  wb.company='Smart Horeca';
  wb.created=new Date();

  const ws=wb.addWorksheet('Отчёт',{
    properties:{defaultRowHeight:20},
    views:[{state:'frozen',ySplit:columns.length?10+kpis.length:1,showGridLines:false}]
  });

  const colCount=Math.max(3,columns.length);
  const lastCol=ws.getColumn(colCount).letter;
  const title=String(report.title||'Отчёт Smart Horeca');

  ws.mergeCells('A1:'+lastCol+'1');
  const titleCell=ws.getCell('A1');
  titleCell.value=title;
  titleCell.font={name:'Aptos Display',size:20,bold:true,color:{argb:'FFFFFFFF'}};
  titleCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#0E2A22')}};
  titleCell.alignment={vertical:'middle',horizontal:'left'};
  ws.getRow(1).height=34;

  ws.mergeCells('A2:'+lastCol+'2');
  const subCell=ws.getCell('A2');
  subCell.value=String(report.subtitle||'AI-отчёт Smart Horeca');
  subCell.font={name:'Aptos',size:10,color:{argb:excelArgb('#A7C5BA')}};
  subCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#0E2A22')}};
  subCell.alignment={vertical:'middle',horizontal:'left'};
  ws.getRow(2).height=22;

  let row=3;
  if(report.periodLabel){
    ws.getCell(row,1).value='Период';
    ws.getCell(row,1).font={bold:true,color:{argb:excelArgb('#50687A')}};
    ws.getCell(row,2).value=String(report.periodLabel);
    ws.getCell(row,2).font={bold:true,color:{argb:excelArgb('#17304A')}};
    row+=2;
  }else row++;

  if(kpis.length){
    ws.getCell(row,1).value='Ключевые показатели';
    ws.getCell(row,1).font={bold:true,size:11,color:{argb:excelArgb('#17304A')}};
    row++;
    const startKpiRow=row;
    kpis.forEach((item,index)=>{
      const r=ws.getRow(row+index);
      r.height=27;
      const label=r.getCell(1);
      const value=r.getCell(2);
      label.value=String(item?.label||'');
      value.value=String(item?.value||'');
      label.font={bold:true,color:{argb:excelArgb('#5D7286')}};
      value.font={bold:true,size:13,color:{argb:excelArgb('#087451')}};
      [label,value].forEach(cell=>{
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#EAF8F2')}};
        cell.border={
          top:{style:'thin',color:{argb:excelArgb('#C7E6D9')}},
          bottom:{style:'thin',color:{argb:excelArgb('#C7E6D9')}},
          left:{style:'thin',color:{argb:excelArgb('#C7E6D9')}},
          right:{style:'thin',color:{argb:excelArgb('#C7E6D9')}}
        };
        cell.alignment={vertical:'middle'};
      });
    });
    row=startKpiRow+kpis.length+1;
  }

  const tableHeaderRow=row;
  columns.forEach((col,index)=>{
    const cell=ws.getCell(tableHeaderRow,index+1);
    cell.value=String(col?.label||'');
    cell.font={bold:true,color:{argb:'FFFFFFFF'},size:10};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#173147')}};
    cell.alignment={vertical:'middle',horizontal:col?.align==='right'?'right':col?.align==='center'?'center':'left'};
    cell.border={bottom:{style:'medium',color:{argb:excelArgb('#42D392')}}};
  });
  ws.getRow(tableHeaderRow).height=27;

  const dataStart=tableHeaderRow+1;
  rows.forEach((source,rowIndex)=>{
    const excelRow=ws.getRow(dataStart+rowIndex);
    excelRow.height=22;
    columns.forEach((col,colIndex)=>{
      const cell=excelRow.getCell(colIndex+1);
      const raw=Array.isArray(source)?source[colIndex]:'';
      const numeric=col?.align==='right'?excelNumeric(raw):null;
      cell.value=numeric==null?String(raw??''):numeric;
      cell.font={color:{argb:excelArgb('#21384F')},size:10};
      cell.alignment={
        vertical:'middle',
        horizontal:col?.align==='right'?'right':col?.align==='center'?'center':'left'
      };
      if(numeric!=null)cell.numFmt='#,##0.00;[Red]-#,##0.00';
      cell.fill={
        type:'pattern',
        pattern:'solid',
        fgColor:{argb:excelArgb(rowIndex%2===0?'#F8FBFD':'#FFFFFF')}
      };
      cell.border={bottom:{style:'thin',color:{argb:excelArgb('#E4ECF1')}}};

      const text=String(raw??'').toLowerCase();
      if(text==='рабочий'){
        cell.font={...cell.font,bold:true,color:{argb:excelArgb('#087451')}};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#EAF8F2')}};
      }else if(text==='нерабочий'){
        cell.font={...cell.font,bold:true,color:{argb:excelArgb('#A76209')}};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#FFF6DF')}};
      }
    });
  });

  let finalDataRow=dataStart+rows.length-1;
  if(totals.length){
    const totalRow=ws.getRow(finalDataRow+1);
    totalRow.height=25;
    columns.forEach((col,index)=>{
      const cell=totalRow.getCell(index+1);
      const raw=totals[index]??'';
      const numeric=col?.align==='right'?excelNumeric(raw):null;
      cell.value=numeric==null?String(raw):numeric;
      cell.font={bold:true,color:{argb:excelArgb('#07543D')}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#DFF5EA')}};
      cell.alignment={vertical:'middle',horizontal:col?.align==='right'?'right':col?.align==='center'?'center':'left'};
      if(numeric!=null)cell.numFmt='#,##0.00;[Red]-#,##0.00';
      cell.border={
        top:{style:'medium',color:{argb:excelArgb('#20B87A')}},
        bottom:{style:'thin',color:{argb:excelArgb('#A9DBC7')}}
      };
    });
    finalDataRow++;
  }

  if(rows.length){
    ws.autoFilter={
      from:{row:tableHeaderRow,column:1},
      to:{row:finalDataRow,column:columns.length}
    };
  }

  row=finalDataRow+2;
  if(notes.length){
    ws.mergeCells(row,1,row,lastCol?colCount:columns.length);
    const noteHead=ws.getCell(row,1);
    noteHead.value='Примечания';
    noteHead.font={bold:true,color:{argb:excelArgb('#17304A')}};
    row++;
    notes.forEach(note=>{
      ws.mergeCells(row,1,row,colCount);
      const cell=ws.getCell(row,1);
      cell.value='• '+String(note||'');
      cell.font={size:9,color:{argb:excelArgb('#60778A')}};
      cell.alignment={wrapText:true,vertical:'top'};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:excelArgb('#F7FAFC')}};
      ws.getRow(row).height=28;
      row++;
    });
  }

  columns.forEach((col,index)=>{
    const values=[
      String(col?.label||''),
      ...rows.slice(0,200).map(r=>String(Array.isArray(r)?(r[index]??''):''))
    ];
    const width=Math.min(34,Math.max(12,...values.map(v=>Math.min(32,v.length+2))));
    ws.getColumn(index+1).width=width;
  });
  if(colCount>columns.length){
    for(let i=columns.length+1;i<=colCount;i++)ws.getColumn(i).width=3;
  }

  ws.pageSetup={
    orientation:columns.length>5?'landscape':'portrait',
    fitToPage:true,
    fitToWidth:1,
    fitToHeight:0,
    margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}
  };

  const buffer=await wb.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=excelSafeName(title+(report.periodLabel?' '+report.periodLabel:''))+'.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function reportCard(report,chart=null,messageIndex=-1){
  if(!report||typeof report!=='object')return'';
  const columns=Array.isArray(report.columns)?report.columns:[];
  const rows=Array.isArray(report.rows)?report.rows:[];
  const totals=Array.isArray(report.totals)?report.totals:[];
  const kpis=Array.isArray(report.kpis)?report.kpis:[];
  const notes=Array.isArray(report.notes)?report.notes:[];
  const align=(value)=>['left','right','center'].includes(value)?value:'left';
  const firstLabel=String(columns[0]?.label||'').toLowerCase();
  const secondLabel=String(columns[1]?.label||'').toLowerCase();
  const groupByCash=columns.length>=2&&firstLabel.includes('касс')&&secondLabel.includes('официант');

  let bodyHtml='';
  if(groupByCash){
    const groups=[];
    const map=new Map();
    rows.forEach(row=>{
      const values=Array.isArray(row)?row:[];
      const key=String(values[0]??'').trim()||'Без кассы';
      if(!map.has(key)){const group={key,rows:[]};map.set(key,group);groups.push(group)}
      map.get(key).rows.push(values);
    });
    bodyHtml=groups.map(group=>
      '<tr class="sha-report-group-row"><td colspan="'+columns.length+'"><span class="sha-report-group-icon">▦</span><strong>'+esc(group.key)+'</strong></td></tr>'+
      group.rows.map(row=>'<tr class="sha-report-child-row">'+columns.map((col,i)=>{
        if(i===0)return '<td class="sha-report-group-spacer"></td>';
        const value=row[i]??'';
        const extra=i===1?' sha-report-child-label':'';
        return '<td class="is-'+align(col?.align)+extra+'">'+esc(value)+'</td>';
      }).join('')+'</tr>').join('')
    ).join('');
  }else{
    bodyHtml=rows.map(row=>'<tr>'+columns.map((col,i)=>'<td class="is-'+align(col?.align)+'">'+esc(Array.isArray(row)?(row[i]??''):'')+'</td>').join('')+'</tr>').join('');
  }

  const table=columns.length
    ? '<div class="sha-report-table-wrap"><table class="sha-report-table"><thead><tr>'+
      columns.map(col=>'<th class="is-'+align(col?.align)+'">'+esc(col?.label||'')+'</th>').join('')+
      '</tr></thead><tbody>'+bodyHtml+'</tbody>'+
      (totals.length?'<tfoot><tr>'+columns.map((col,i)=>'<td class="is-'+align(col?.align)+'">'+esc(totals[i]??'')+'</td>').join('')+'</tr></tfoot>':'')+
      '</table></div>'
    :'';
  return '<section class="sha-report">'+
    '<div class="sha-report-head"><div><span class="sha-report-eyebrow">SMART HORECA REPORT</span><h3>'+esc(report.title||'Отчёт')+'</h3>'+
    (report.subtitle?'<p>'+esc(report.subtitle)+'</p>':'')+'</div>'+
    '<div class="sha-report-head-actions">'+
      (report.periodLabel?'<span class="sha-report-period">'+esc(report.periodLabel)+'</span>':'')+
      (messageIndex>=0?'<button type="button" class="sha-report-excel" data-export-report-index="'+messageIndex+'" title="Выгрузить отчёт в Excel">▦ Excel</button>':'')+
    '</div>'+
    '</div>'+
    (kpis.length?'<div class="sha-report-kpis">'+kpis.map(item=>'<div class="sha-report-kpi"><span>'+esc(item?.label||'')+'</span><strong>'+esc(item?.value||'')+'</strong></div>').join('')+'</div>':'')+
    (chart?'<div class="sha-report-chart-slot">'+chartCard(chart)+'</div>':'')+
    table+
    (notes.length?'<div class="sha-report-notes">'+notes.map(note=>'<div>'+esc(note)+'</div>').join('')+'</div>':'')+
    '</section>';
}

function tools(meta){const map={list_smart_horeca_capabilities:'Источники SmartHoreca',search_products:'Номенклатура',analyze_purchase_prices:'Приходные накладные',get_supplier_balances:'Баланс по поставщикам',search_olap_fields:'Поля OLAP',run_olap_report:'OLAP отчёт'};const a=Array.isArray(meta?.tools)?meta.tools:[];return a.length?'<div class="sha-tools-used">'+a.map(x=>'<span class="sha-tool-chip">'+esc(map[x.name]||x.name)+(x.error?' · ошибка':'')+'</span>').join('')+'</div>':''}
function msg(m,index=-1){
  const ai=m.role==='assistant';
  const speak=ai&&index>=0?'<button class="sha-speak" type="button" data-speak-index="'+index+'" title="Озвучить ответ">🔊 Озвучить</button>':'';
  const hasReport=ai&&m.meta?.report;
  const hasChart=ai&&m.meta?.chart;
  const structured=hasReport?reportCard(m.meta.report,hasChart?m.meta.chart:null,index):(hasChart?chartCard(m.meta.chart):'');
  const text=esc(m.content).replace(/\n/g,'<br>');
  return '<article class="sha-message '+(ai?'assistant':'user')+'"><div class="sha-avatar">'+(ai?'AI':'Вы')+'</div><div class="sha-bubble '+(structured?'has-report':'')+'">'+
    (text?'<div class="sha-text">'+text+'</div>':'')+
    structured+
    (ai?tools(m.meta):'')+speak+
    '</div></article>';
}
function renderMessages(a){currentMessages=Array.isArray(a)?a:[];$('welcome').hidden=currentMessages.length>0;$('messages').innerHTML=currentMessages.map((m,i)=>msg(m,i)).join('');requestAnimationFrame(()=>{$('messages').scrollTop=$('messages').scrollHeight})}
function renderChats(){$('conversationEmpty').hidden=conversations.length>0;$('conversationList').innerHTML=conversations.map(x=>'<button class="sha-conversation '+(x.id===currentId?'active':'')+'" data-id="'+esc(x.id)+'"><strong>'+esc(x.title||'Новый чат')+'</strong><span>'+esc(fmt(x.updated_at))+'</span></button>').join('');$('conversationList').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>select(b.dataset.id))}
function state(t,k){const el=$('assistantState');if(!el)return;el.textContent=t;el.className='sha-state '+(k||'')}
function note(t,k){$('composerStatus').textContent=t||'';$('composerStatus').className='sha-composer-status '+(k||'')}
function size(){const i=$('messageInput');i.style.height='auto';i.style.height=Math.min(160,Math.max(36,i.scrollHeight))+'px'}
async function loadStatus(){const j=await get('?action=status');if(!j.configured){state('OpenAI не настроен','warn');note('Добавьте OPENAI_API_KEY в Cloudflare Preview.','error');return}state(j.model+' · '+(j.iikoConnected?'iiko подключён':'iiko не подключён'),j.iikoConnected?'ok':'warn')}
async function loadChats(){const j=await get('?action=conversations');conversations=j.conversations||[];renderChats()}
async function select(id){currentId=id;renderChats();const j=await get('?action=messages&conversationId='+encodeURIComponent(id));$('chatTitle').textContent=j.conversation?.title||'AI Smart Horeca Assistent';$('deleteChatBtn').hidden=false;renderMessages(j.messages||[])}
async function newChat(){const j=await post({action:'newConversation',title:'Новый чат'});currentId=j.conversation.id;await loadChats();$('chatTitle').textContent='Новый чат';$('deleteChatBtn').hidden=false;renderMessages([]);$('messageInput').focus()}
function thinking(){const n=document.createElement('article');n.id='shaThinking';n.className='sha-message assistant';n.innerHTML='<div class="sha-avatar">AI</div><div class="sha-bubble"><span class="sha-thinking"><i></i><i></i><i></i></span> Анализирую данные SmartHoreca…</div>';$('messages').appendChild(n);$('welcome').hidden=true;$('messages').scrollTop=$('messages').scrollHeight}
function voiceMimeType(){
  const options=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];
  return options.find(type=>window.MediaRecorder?.isTypeSupported?.(type))||'';
}
function voiceExtension(type){if(type.includes('mp4'))return'm4a';if(type.includes('ogg'))return'ogg';return'webm'}
function setRecordingUi(active){
  const button=$('micBtn'),timer=$('recordTimer');
  button.classList.toggle('recording',active);
  button.setAttribute('aria-pressed',active?'true':'false');
  button.title=active?'Остановить запись':'Голосовой запрос';
  timer.hidden=!active;
  if(!active)timer.textContent='0:00';
}
function cleanupRecording(){
  if(recordTicker){clearInterval(recordTicker);recordTicker=null}
  if(recordStopTimer){clearTimeout(recordStopTimer);recordStopTimer=null}
  if(mediaStream){mediaStream.getTracks().forEach(track=>track.stop());mediaStream=null}
  mediaRecorder=null;
  setRecordingUi(false);
}
function updateRecordTimer(){
  const elapsed=Math.max(0,Math.floor((Date.now()-recordStarted)/1000));
  $('recordTimer').textContent=Math.floor(elapsed/60)+':'+String(elapsed%60).padStart(2,'0');
}
async function transcribeVoice(blob,mimeType){
  const t=await token(),form=new FormData();
  form.set('audio',blob,'voice.'+voiceExtension(mimeType||blob.type||''));
  const r=await fetch('/api/ai-assistant-transcribe',{method:'POST',headers:{Authorization:'Bearer '+t},body:form});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
  return j.text;
}
async function speakText(text,button=null){
  const value=String(text||'').trim();
  if(!value)return;
  if(currentAudio){currentAudio.pause();currentAudio=null}
  if(currentAudioUrl){URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=''}
  if(button)button.classList.add('playing');
  note('Озвучиваю ответ…');
  try{
    const t=await token();
    const r=await fetch('/api/ai-assistant-speech',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({text:value})});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.message||('HTTP '+r.status))}
    const blob=await r.blob();
    currentAudioUrl=URL.createObjectURL(blob);
    currentAudio=new Audio(currentAudioUrl);
    currentAudio.onended=()=>{if(button)button.classList.remove('playing');note('')};
    currentAudio.onerror=()=>{if(button)button.classList.remove('playing');note('Не удалось воспроизвести голосовой ответ.','error')};
    await currentAudio.play();
  }catch(e){
    if(button)button.classList.remove('playing');
    note(e.message||String(e),'error');
  }
}
async function finishVoiceRecording(blob,mimeType){
  if(!blob||blob.size<800){note('Запись слишком короткая. Попробуйте ещё раз.','error');return}
  note('Распознаю голос…');
  try{
    const text=await transcribeVoice(blob,mimeType);
    $('messageInput').value=text;
    size();
    note('Распознано: «'+text+'»');
    await send({speakReply:true});
  }catch(e){note(e.message||String(e),'error')}
}
async function startVoice(){
  if(busy)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Браузер не поддерживает запись с микрофона.');
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const mimeType=voiceMimeType();
  mediaRecorder=mimeType?new MediaRecorder(mediaStream,{mimeType}):new MediaRecorder(mediaStream);
  audioChunks=[];
  mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data)};
  mediaRecorder.onerror=e=>{note(e.error?.message||'Ошибка записи микрофона.','error');cleanupRecording()};
  mediaRecorder.onstop=()=>{
    const type=mediaRecorder?.mimeType||mimeType||'audio/webm';
    const blob=new Blob(audioChunks,{type});
    cleanupRecording();
    finishVoiceRecording(blob,type);
  };
  mediaRecorder.start(250);
  recordStarted=Date.now();
  setRecordingUi(true);
  updateRecordTimer();
  recordTicker=setInterval(updateRecordTimer,500);
  recordStopTimer=setTimeout(()=>{if(mediaRecorder?.state==='recording')mediaRecorder.stop()},120000);
  note('Слушаю… Нажмите микрофон ещё раз, когда закончите.');
}
function stopVoice(){if(mediaRecorder?.state==='recording')mediaRecorder.stop()}
async function toggleVoice(){
  if(mediaRecorder?.state==='recording'){stopVoice();return}
  try{await startVoice()}catch(e){cleanupRecording();note(e.message||String(e),'error')}
}
async function send(options={}){if(busy)return;const i=$('messageInput'),text=i.value.trim();if(!text)return;busy=true;$('sendBtn').disabled=true;$('micBtn').disabled=true;note('Получаю данные и собираю ответ…');i.value='';size();$('welcome').hidden=true;$('messages').insertAdjacentHTML('beforeend',msg({role:'user',content:text}));thinking();try{const j=await post({action:'message',conversationId:currentId||null,message:text});currentId=j.conversationId;await loadChats();await select(currentId);note('');if(options?.speakReply&&j.answer)await speakText(j.answer)}catch(e){document.getElementById('shaThinking')?.remove();note(e.message,'error');if(e.code==='OPENAI_NOT_CONFIGURED')state('OpenAI не настроен','warn')}finally{busy=false;$('sendBtn').disabled=false;$('micBtn').disabled=false;i.focus()}}
async function del(){if(!currentId||!confirm('Удалить этот AI-диалог?'))return;await post({action:'deleteConversation',conversationId:currentId});currentId='';$('deleteChatBtn').hidden=true;$('chatTitle').textContent='AI Smart Horeca Assistent';renderMessages([]);await loadChats()}
function bind(){$('newChatBtn').onclick=()=>newChat().catch(e=>note(e.message,'error'));$('deleteChatBtn').onclick=()=>del().catch(e=>note(e.message,'error'));$('sendBtn').onclick=()=>send();$('micBtn').onclick=toggleVoice;$('messageInput').oninput=size;$('messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};$('messages').addEventListener('click',e=>{
  const exportButton=e.target.closest?.('[data-export-report-index]');
  if(exportButton){
    const index=Number(exportButton.dataset.exportReportIndex);
    const report=currentMessages[index]?.meta?.report;
    exportReportToExcel(report)
      .then(()=>note('Excel-файл сформирован.','ok'))
      .catch(error=>note(error.message||String(error),'error'));
    return;
  }
  const button=e.target.closest?.('[data-speak-index]');
  if(!button)return;
  const index=Number(button.dataset.speakIndex);
  const message=currentMessages[index];
  if(message?.role==='assistant')speakText(message.content,button)
});document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{$('messageInput').value=b.dataset.example||b.textContent;size();send()})}
async function init(){bind();try{await Promise.all([loadStatus(),loadChats()]);if(conversations[0])await select(conversations[0].id)}catch(e){state('Ошибка','error');note(e.message,'error')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();