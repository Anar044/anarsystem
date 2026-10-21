const clean=v=>String(v??"").trim();
const money=value=>Number(value).toLocaleString("ru-RU",{
  minimumFractionDigits:2,maximumFractionDigits:2});

export function verifiedRevenuePresentation(data,{chartRequested=true}={}) {
  if(data?.success!==true || data?.kind!=="verified_revenue_comparison" ||
      !Array.isArray(data.rows)||!data.rows.length ||
      !data.period?.from||!data.period?.to) return null;
  if(data.rows.some(row=>!clean(row.departmentName) ||
      typeof row.revenue!=="number"||!Number.isFinite(row.revenue)))return null;
  const period=`${data.period.from} — ${data.period.to}`;
  const displayed=data.rows.slice(0,30);
  const missing=Array.isArray(data.restaurantsWithoutRows)?
    data.restaurantsWithoutRows:[];
  const notes=[
    `Источник: SH OLAP SALES; поле выручки: ${data.revenueField}.`,
    `Подтверждено строк OLAP: ${data.sourceRows}. Суммы только по полученным подразделениям.`,
    ...(missing.length?[
      `Для ${missing.length} выбранных подразделений OLAP не вернул строк: ${missing.slice(0,8).map(x=>x.departmentName).join(", ")}. Их выручка неизвестна, а не ноль.`
    ]:[]),
    ...(data.rows.length>displayed.length?
      [`Показаны первые ${displayed.length} подразделений из ${data.rows.length}.`]:[])
  ];
  const report={
    title:"Выручка ресторанов",subtitle:`Сравнение за ${period}`,
    periodLabel:period,
    kpis:[
      {label:"Выручка по полученным данным",value:`${money(data.totalRevenue)} AZN`},
      {label:"Подразделений со строками продаж",value:String(data.restaurantsWithRows)}
    ],
    columns:[
      {label:"Ресторан / подразделение",align:"left"},
      {label:"Выручка, AZN",align:"right"}
    ],
    rows:displayed.map(row=>[row.departmentName,money(row.revenue)]),
    totals:["Итого по полученным данным",money(data.totalRevenue)],
    notes
  };
  const chart=chartRequested?{
    type:"horizontal_bar",title:"Выручка по ресторанам",subtitle:period,
    xLabel:"Ресторан",yLabel:"Выручка, AZN",
    series:[{name:"Выручка",data:displayed.slice(0,24).map(row=>({
      label:row.departmentName,value:row.revenue
    }))}],
    notes:notes.slice(1,3)
  }:null;
  return {
    kind:chart?"report_with_chart":"report",
    text:`Выручка по ${data.restaurantsWithRows} из ${data.selectedRestaurantCount} выбранных подразделений за ${period} — ${money(data.totalRevenue)} AZN. ${missing.length?"Для остальных данных в ответе OLAP нет; они не включены в итог.":""}`.trim(),
    report,chart
  };
}
