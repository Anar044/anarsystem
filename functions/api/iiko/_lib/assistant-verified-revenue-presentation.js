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
  // User-facing reports show one concise warning, not repeated OLAP internals.
  const notes=[
    ...(missing.length?[
      `Без данных по ${missing.length} подразделениям: ${missing.slice(0,8).map(x=>x.departmentName).join(", ")}. Они не включены в сумму.`
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
  const oneRestaurant=displayed.length===1;
  const daily=oneRestaurant && Array.isArray(data.days)?
    data.days.filter(day=>day.departmentId===displayed[0].departmentId &&
      typeof day.revenue==="number" && Number.isFinite(day.revenue))
      .sort((a,b)=>a.date.localeCompare(b.date)): [];
  // When only one restaurant sold anything, compare its observed sales DAYS.
  // Do not insert zero bars for missing dates: those days are unverified.
  const useDailyTrend=oneRestaurant && daily.length>=2;
  const chartRows=useDailyTrend ? daily.slice(0,32).map(day=>({
    label:`${day.date.slice(8,10)}.${day.date.slice(5,7)}`,
    value:day.revenue
  })) : displayed.slice(0,24).map(row=>({
    label:row.departmentName,value:row.revenue
  }));
  const chart=chartRequested?{
    type:useDailyTrend?"daily_trend":"horizontal_bar",
    title:useDailyTrend?"Выручка по дням":"Выручка по ресторанам",
    subtitle:useDailyTrend?`${displayed[0].departmentName} · ${period}`:period,
    xLabel:useDailyTrend?"День":"Ресторан",yLabel:"Выручка, AZN",
    series:[{name:"Выручка",data:chartRows}],
    notes:useDailyTrend?["Показаны только дни с данными о продажах."]: []
  }:null;
  return {
    kind:chart?"report_with_chart":"report",
    text:`Выручка по ${data.restaurantsWithRows} из ${data.selectedRestaurantCount} выбранных подразделений за ${period} — ${money(data.totalRevenue)} AZN. ${missing.length?"Для остальных данных в ответе OLAP нет; они не включены в итог.":""}`.trim(),
    report,chart
  };
}
