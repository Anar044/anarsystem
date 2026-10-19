import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");

function backendHelpers() {
  const source = read("functions/api/ai-assistant.js")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm, "")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|let|var))/g, "");
  return new Function(source + "\nreturn {brandVisibleText,brandPresentation,brandSavedAssistantMessage};")();
}
function frontendHelpers() {
  const source = read("ai-assistant.js").replace(
    /\}\)\(\);\s*$/,
    "window.__testBranding={msg,brandVisibleText,brandPresentation};})();"
  );
  const window = {};
  const document = {readyState:"loading",addEventListener(){}};
  new Function("window","document",source)(window,document);
  return window.__testBranding;
}
function sample() {
  return {
    report: {
      title:"Продажи iiko",
      subtitle:"Данные OLAP iiko, iikoChain и IIKOFront",
      periodLabel:"01.10.2026–16.10.2026",
      kpis:[{label:"Чеки iiko",value:"39"}],
      columns:[{label:"Ресторан iiko",align:"left"},{label:"Сумма",align:"right"}],
      rows:[["iikoOffice","1 752,40"]],
      totals:["Итого iiko","1 752,40"],
      notes:["Источник iikoChain"]
    },
    chart:{
      type:"bar",
      title:"Сравнение iiko",
      subtitle:"iiko",
      series:[{name:"iiko продажи",data:[{label:"iikoFront",value:1752.4}]}],
      notes:["iiko"]
    }
  };
}

test("backend white-labels AI presentation, preserves user text and technical values",()=>{
  const h=backendHelpers(), {report,chart}=sample();
  const ai=h.brandSavedAssistantMessage({
    role:"assistant",
    content:"Сводка iiko и iikoChain",
    meta:{report,chart,charts:[chart],tools:[{name:"run_olap_report"}]}
  });
  assert.doesNotMatch(JSON.stringify({content:ai.content,report:ai.meta.report,charts:ai.meta.charts,chart:ai.meta.chart}),/iiko/i);
  assert.equal(ai.meta.report.rows[0][1],"1 752,40");
  assert.equal(ai.meta.chart.series[0].data[0].value,1752.4);
  assert.equal(ai.meta.tools[0].name,"run_olap_report");
  assert.equal(h.brandSavedAssistantMessage({role:"user",content:"Проверь iiko"}).content,"Проверь iiko");
  assert.equal(report.subtitle,"Данные OLAP iiko, iikoChain и IIKOFront"); // no DB/source mutation
});

test("chat UI and charts white-label old AI messages, not questions",()=>{
  const h=frontendHelpers(), {report,chart}=sample();
  const ai=h.msg({role:"assistant",content:"Отчёт iiko",meta:{report,chart}},0);
  assert.doesNotMatch(ai,/iiko/i);
  assert.match(ai,/Smart Horeca/);
  const user=h.msg({role:"user",content:"Отчёт iiko?"},1);
  assert.match(user,/iiko/);
  const output=h.brandPresentation(report);
  assert.doesNotMatch(JSON.stringify(output),/iiko/i);
  assert.equal(output.rows[0][1],"1 752,40");
});

test("PDF white-labels previously saved report, notes, chart and filename",async()=>{
  const {report,chart}=sample();
  let document,filename;
  const window={pdfMake:{createPdf(doc){
    document=doc;
    return {download(name,cb){filename=name;cb();}};
  }}};
  new Function("window",read("ai-report-pdf.js"))(window);
  await window.SHAIExportPDF.download({report,charts:[chart],summary:"Данные iiko"});
  assert.doesNotMatch(JSON.stringify(document),/iiko/i);
  assert.doesNotMatch(filename,/iiko/i);
  assert.match(filename,/Smart Horeca/);
  assert.ok(document.content.some(item=>item.svg));
  assert.ok(document.content.some(item=>item.table));
  assert.equal(report.subtitle,"Данные OLAP iiko, iikoChain и IIKOFront");
});

test("client cache versions are bumped to take effect immediately",()=>{
  const html=read("ai-assistant.html");
  assert.match(html,/ai-assistant\.js\?v=10/);
  assert.match(html,/ai-report-pdf\.js\?v=2/);
});
