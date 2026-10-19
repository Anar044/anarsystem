/* Smart Horeca AI: data-based, selectable-text PDF executive reports. */
(()=>{
'use strict';
const PALETTE=['#169B72','#347AC3','#D59B2D','#815CB6','#D85F6A','#1C9CAA'];
const ink='#172F42',muted='#597184',line='#DBE7EB',green='#087451';
// Clean generated and previously saved reports at export time.
const str=v=>String(v??'')
  .replace(/\biiko(?:chain|front|office|server|rms|cloud)?\b/gi,'Smart Horeca')
  .replace(/\u20BC/g,' AZN');
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const fmt=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(num(v));
const color=i=>PALETTE[i%PALETTE.length];
const safeName=v=>String(v||'Smart Horeca AI').replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90)||'Smart Horeca AI';
const xml=(n)=>Number(n.toFixed(2));
function seriesData(chart){
  const series=(Array.isArray(chart?.series)?chart.series:[]).filter(s=>Array.isArray(s?.data)&&s.data.length).slice(0,4);
  const labels=[...new Set(series.flatMap(s=>s.data.map(p=>str(p.label))))].slice(0,12);
  return {series,labels,values:series.map(s=>labels.map(label=>num(s.data.find(p=>str(p.label)===label)?.value)))};
}
function shapeChart(chart){
  const {series,labels,values}=seriesData(chart);
  if(!series.length||!labels.length)return null;
  const type=String(chart.type||'bar');
  const W=640,H=218,elems=[];
  if(type==='pie'||type==='donut'){
    const all=series[0].data.filter(p=>num(p?.value)>0);
    const data=all.length>10?[...all.slice(0,9),{label:'Остальные',value:all.slice(9).reduce((n,p)=>n+num(p?.value),0)}]:all;
    const total=data.reduce((n,p)=>n+num(p?.value),0);
    if(!total)return null;
    const cx=320,cy=109,r=93;
    let prev=-Math.PI/2;
    for(let i=0;i<data.length;i++){
      const fraction=num(data[i].value)/total;
      const sweep=fraction*Math.PI*2;
      if(fraction>0.999999){
        elems.push('<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+color(i)+'"/>');
      }else if(sweep>0){
        const end=prev+sweep;
        const x1=xml(cx+r*Math.cos(prev)),y1=xml(cy+r*Math.sin(prev));
        const x2=xml(cx+r*Math.cos(end)),y2=xml(cy+r*Math.sin(end));
        elems.push('<path d="M '+cx+' '+cy+' L '+x1+' '+y1+' A '+r+' '+r+' 0 '+(sweep>Math.PI?1:0)+' 1 '+x2+' '+y2+' Z" fill="'+color(i)+'"/>');
      }
      prev+=sweep;
    }
    if(type==='donut')elems.push('<circle cx="'+cx+'" cy="'+cy+'" r="52" fill="#FFFFFF"/>');
    return {svg:'<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+elems.join('')+'</svg>',rows:data.map((p,i)=>({label:str(p.label),values:[num(p.value)],percent:num(p.value)/total*100,color:color(i)})),names:[str(series[0].name||'Значение')],type};
  }
  const all=values.flat(),min=Math.min(0,...all),max=Math.max(0,...all),span=Math.max(1,max-min);
  const left=60,right=30,top=15,bottom=36,plotW=W-left-right,plotH=H-top-bottom;
  const y=v=>xml(top+(max-v)/span*plotH);
  const zero=y(0);
  for(let i=0;i<=4;i++){
    const gy=xml(top+i*plotH/4);
    elems.push('<line x1="'+left+'" y1="'+gy+'" x2="'+(W-right)+'" y2="'+gy+'" stroke="#E1E8EC" stroke-width="1"/>');
  }
  elems.push('<line x1="'+left+'" y1="'+zero+'" x2="'+(W-right)+'" y2="'+zero+'" stroke="#8FA5B2" stroke-width="1.3"/>');
  if(type==='line'||type==='area'){
    for(let si=0;si<series.length;si++){
      const points=values[si].map((v,i)=>[xml(left+(i+.5)/labels.length*plotW),y(v)]);
      const poly=points.map(p=>p.join(',')).join(' ');
      if(type==='area'&&points.length>1){
        elems.push('<polygon points="'+points[0][0]+','+zero+' '+poly+' '+points[points.length-1][0]+','+zero+'" fill="'+color(si)+'" fill-opacity=".16"/>');
      }
      elems.push('<polyline points="'+poly+'" fill="none" stroke="'+color(si)+'" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>');
      points.forEach(([x,yy])=>elems.push('<circle cx="'+x+'" cy="'+yy+'" r="3" fill="'+color(si)+'"/>'));
    }
  }else if(type==='horizontal_bar'){
    // Horizontal bars with a shared zero line, including negative values.
    const rowH=plotH/Math.max(1,labels.length);
    const x=v=>xml(left+(v-min)/span*plotW);
    for(let i=0;i<labels.length;i++){
      series.forEach((s,si)=>{
        const v=values[si][i],barH=Math.max(3,Math.min(11,rowH/Math.max(1,series.length)-2));
        const yy=xml(top+i*rowH+si*(barH+2)+(rowH-series.length*(barH+2))/2);
        elems.push('<rect x="'+Math.min(x(0),x(v))+'" y="'+yy+'" width="'+Math.max(.5,Math.abs(x(v)-x(0)))+'" height="'+barH+'" rx="2" fill="'+color(si)+'"/>');
      });
    }
    elems.push('<line x1="'+x(0)+'" y1="'+top+'" x2="'+x(0)+'" y2="'+(H-bottom)+'" stroke="#8FA5B2"/>');
  }else{
    const groupW=plotW/labels.length, barW=Math.max(3,Math.min(38,groupW/(series.length+1)));
    for(let i=0;i<labels.length;i++)series.forEach((s,si)=>{
      const v=values[si][i];
      const xx=xml(left+i*groupW+(groupW-series.length*barW)/2+si*barW);
      elems.push('<rect x="'+xx+'" y="'+Math.min(y(v),zero)+'" width="'+xml(barW-2)+'" height="'+Math.max(.5,Math.abs(y(v)-zero))+'" rx="2" fill="'+color(si)+'"/>');
    });
  }
  // Indices are ASCII-only; complete category labels are typeset below in the PDF table.
  labels.forEach((label,i)=>{
    const xx=type==='horizontal_bar'?36:xml(left+(i+.5)/labels.length*plotW);
    const yy=type==='horizontal_bar'?xml(top+(i+.5)/labels.length*plotH+4):H-14;
    elems.push('<text x="'+xx+'" y="'+yy+'" text-anchor="middle" fill="#597184" font-size="10">'+(i+1)+'</text>');
  });
  return {svg:'<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+elems.join('')+'</svg>',rows:labels.map((label,i)=>({label,values:values.map(v=>v[i]),color:color(i)})),names:series.map(s=>str(s.name||'Значение')),type};
}
function chartBlock(chart){
  const shape=shapeChart(chart);
  if(!shape)return[];
  const header=[{text:'№',bold:true},{text:'Показатель',bold:true},...shape.names.map(name=>({text:name,bold:true,alignment:'right'}))];
  if(shape.type==='pie'||shape.type==='donut')header.push({text:'Доля',bold:true,alignment:'right'});
  const body=[header,...shape.rows.map((r,i)=>[
    {text:String(i+1),color:(shape.type==='pie'||shape.type==='donut')?r.color:muted},
    {text:r.label},
    ...r.values.map(v=>({text:fmt(v),alignment:'right'})),
    ...((shape.type==='pie'||shape.type==='donut')?[{text:fmt(r.percent)+'%',alignment:'right'}]:[])
  ])];
  const widths=['auto','*',...shape.names.map(()=>'auto'),...((shape.type==='pie'||shape.type==='donut')?['auto']:[])];
  const blocks=[
    {text:str(chart.title||'Диаграмма'),style:'chartTitle',margin:[0,18,0,3]},
    ...(chart.subtitle?[{text:str(chart.subtitle),style:'subtext',margin:[0,0,0,8]}]:[]),
    {svg:shape.svg,fit:[515,175],alignment:'center',margin:[0,5,0,8]},
    {table:{headerRows:1,widths,body},layout:{fillColor:(i)=>i===0?'#E7F6F0':(i%2===0?'#F6F9FA':null),hLineColor:()=>line,vLineColor:()=>line,paddingLeft:()=>6,paddingRight:()=>6,paddingTop:()=>4,paddingBottom:()=>4},fontSize:7.3},
  ];
  if(chart.notes?.length)blocks.push({text:chart.notes.map(str).join(' · '),style:'note',margin:[0,7,0,3]});
  return blocks;
}
function kpiBlocks(kpis){
  const blocks=[];
  for(let offset=0;offset<kpis.length;offset+=3){
    const group=kpis.slice(offset,offset+3);
    const cells=group.map(item=>({stack:[
      {text:str(item.label),fontSize:8,color:muted,margin:[0,0,0,6]},
      {text:str(item.value),fontSize:15,bold:true,color:green}
    ],fillColor:'#EAF7F1',margin:[0,0,0,0]}));
    while(cells.length<3)cells.push({text:''});
    blocks.push({table:{widths:['*','*','*'],body:[cells]},layout:{hLineWidth:()=>0,vLineWidth:()=>0,paddingLeft:()=>12,paddingRight:()=>12,paddingTop:()=>10,paddingBottom:()=>10},margin:[0,0,0,7]});
  }
  return blocks;
}
function reportTable(report,landscape){
  const cols=Array.isArray(report.columns)?report.columns:[];
  const rows=Array.isArray(report.rows)?report.rows:[];
  if(!cols.length)return[];
  const widths=cols.map((_,i)=>i===0?'*':'auto');
  const body=[cols.map(col=>({text:str(col.label),bold:true,color:'#FFFFFF',alignment:col.align==='right'?'right':'left'}))];
  for(const row of rows)body.push(cols.map((col,i)=>({text:str(Array.isArray(row)?row[i]:''),alignment:col.align==='right'?'right':(col.align==='center'?'center':'left')})));
  if(Array.isArray(report.totals)&&report.totals.length)body.push(cols.map((col,i)=>({text:str(report.totals[i]),bold:true,color:green,alignment:col.align==='right'?'right':'left'})));
  return [
    {text:'Детализация',style:'sectionTitle',margin:[0,20,0,8]},
    {table:{headerRows:1,widths,body,dontBreakRows:true,keepWithHeaderRows:1},layout:{
      fillColor:(i)=>i===0?'#163A42':(i%2===0?'#F3F7F8':null),
      hLineColor:()=>line,vLineColor:()=>line,
      paddingLeft:()=>5,paddingRight:()=>5,paddingTop:()=>6,paddingBottom:()=>6
    },fontSize:cols.length>6?6.5:7.5}
  ];
}
function download({report=null,charts=[],summary='' }={}){
  if(!window.pdfMake?.createPdf)throw Error('Библиотека PDF не загрузилась. Проверьте соединение и обновите страницу.');
  const candidates=(Array.isArray(charts)?charts:[]).filter(c=>c&&Array.isArray(c.series));
  if(!report&&!candidates.length)throw Error('Нет отчёта или диаграммы для PDF.');
  const title=str(report?.title||candidates[0]?.title||'AI аналитика');
  const cols=Array.isArray(report?.columns)?report.columns:[];
  const landscape=cols.length>5;
  const now=new Date().toLocaleString('ru-RU',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const content=[
    {columns:[
      {text:'SMART HORECA',color:green,bold:true,fontSize:13},
      {text:'AI ANALYTICS',color:muted,fontSize:9,alignment:'right'}
    ],margin:[0,0,0,16]},
    {text:title,fontSize:22,bold:true,color:ink,margin:[0,0,0,6]},
    ...(report?.subtitle?[{text:str(report.subtitle),color:muted,fontSize:11,margin:[0,0,0,5]}]:[]),
    ...(report?.periodLabel?[{text:'Период: '+str(report.periodLabel),fontSize:9,color:green,margin:[0,0,0,12]}]:[]),
    ...(summary?[{text:str(summary).slice(0,1200),fontSize:9,color:ink,margin:[0,0,0,15]}]:[]),
    ...kpiBlocks(Array.isArray(report?.kpis)?report.kpis:[]),
    ...candidates.slice(0,3).flatMap(chartBlock),
    ...reportTable(report||{},landscape)
  ];
  if(report?.notes?.length)content.push(
    {text:'Примечания и ограничения',style:'sectionTitle',margin:[0,18,0,7]},
    ...report.notes.map(note=>({text:'• '+str(note),style:'note',margin:[0,0,0,4]}))
  );
  content.push({text:'Источник: данные, доступные AI Smart Horeca Assistant в момент формирования отчёта.',style:'note',margin:[0,18,0,0]});
  const doc={
    pageSize:'A4',pageOrientation:landscape?'landscape':'portrait',
    pageMargins:[38,48,38,47],
    defaultStyle:{font:'Roboto',fontSize:9,color:ink},
    styles:{chartTitle:{fontSize:13,bold:true,color:ink},sectionTitle:{fontSize:13,bold:true,color:ink},subtext:{fontSize:9,color:muted},note:{fontSize:8,color:muted,italics:true}},
    content,
    footer:(page,count)=>({columns:[
      {text:'Smart Horeca · '+now,color:muted,fontSize:8},
      {text:String(page)+' / '+String(count),color:muted,fontSize:8,alignment:'right'}
    ],margin:[38,12,38,0]})
  };
  return new Promise((resolve,reject)=>{
    try{window.pdfMake.createPdf(doc).download(safeName(title+(report?.periodLabel?' '+report.periodLabel:''))+'.pdf',()=>resolve());}
    catch(error){reject(error);}
  });
}
window.SHAIExportPDF=Object.freeze({download});
})();