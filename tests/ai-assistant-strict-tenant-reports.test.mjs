import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAssistantTenantTarget } from "../functions/api/iiko/_lib/ai-assistant-tenant-guard.js";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const route = read("functions/api/ai-assistant.js");
const source = read("functions/api/iiko/_lib/ai-assistant-tools.js");
const access = {
  allowed:true,storageUserId:"platform-org:second-cup",
  workspace:{id:"w-second",name:"Second Cup Testing"},
  workspaces:[
    {id:"w-second",name:"Second Cup Testing"},
    {id:"w-office",name:"Test Office Chain",memberStatus:"ACTIVE"}
  ]
};
const chain = (selected=["r1"])=>({
  mode:"CHAIN",isChain:true,selectedDepartmentIds:selected,
  allowedDepartmentIds:["r1","r2"],
  selectedRestaurants:selected.map(id=>({id,name:id==="r1"?"White City":"Airport"})),
  allRestaurants:[{id:"r1",name:"White City"},{id:"r2",name:"Airport"}]
});

test("Active organization is never inferred from other memberships or user's text",()=>{
  for(const input of [
    "покажи мне отчёт другой сети за октябрь",
    "покажи продажи Test Office Chain по кассам",
    "отчет test ofis за октябрь",
    "Give me October sales for another organization"
  ]){
    const result=checkAssistantTenantTarget(input,access,chain(["r1"]));
    assert.equal(result.allowed,false,input);
    assert.equal(result.code,"ASSISTANT_OTHER_TENANT_REQUEST");
  }
  assert.equal(checkAssistantTenantTarget("Покажи продажи Second Cup Testing за октябрь",access,chain()).allowed,true);
  assert.equal(checkAssistantTenantTarget("Сумма продаж за октябрь",access,chain()).allowed,true);
});
test("Restaurant outside active selection is forbidden even when same user can access it",()=>{
  const result=checkAssistantTenantTarget("Продажи Airport за октябрь",access,chain(["r1"]));
  assert.equal(result.allowed,false);
  assert.equal(result.code,"ASSISTANT_OTHER_RESTAURANT_REQUEST");
  assert.equal(checkAssistantTenantTarget("Продажи Airport за октябрь",access,chain(["r1","r2"])).allowed,true);
  assert.equal(checkAssistantTenantTarget("Продажи White City за октябрь",access,chain(["r1"])).allowed,true);
});
test("Absent verified tenant is blocked before AI tooling",()=>{
  assert.equal(checkAssistantTenantTarget("sales",{allowed:true,workspace:{id:"w"},storageUserId:""},chain()).allowed,false);
  assert.match(route,/checkAssistantTenantTarget\(text,iiko\.access,iiko\.scope\)/);
  assert.match(route,/if\(!target\.allowed\)return json\(/);
  assert.match(route,/instructions\(model, Boolean\(connection\),scope,access\)/);
});

function harness({fields=["Department.Id","OpenDate.Typed","CashRegister.Name","DishDiscountSumInt"],
  payload=[{"Department.Id":"r1","CashRegister.Name":"Kassa 1",DishDiscountSumInt:123}],
  getFieldError=false}={}){
  const calls=[];
  const mock={
    clean:v=>String(v??"").trim(),
    iikoReferenceScope:()=> "http://shared",
    getOlapFields:async()=>({raw:getFieldError?[]:fields}),
    iikoJson:async(c,path,opt)=>{
      calls.push({path,request:opt?.body?JSON.parse(opt.body):null});
      return {ok:true,payload}
    },
    iikoText:async()=>({ok:false,status:404,text:""}),
    syncReferences:async()=>({maps:{products:new Map(),warehouses:new Map(),suppliers:new Map()}}),
    getIikoSuppliers:async()=>({rows:[]}),
    resolveStoreScope:async()=>({resolved:true,storeIds:["s1"]})
  };
  const executable=source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm,"")
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|let|var))/g,"");
  const api=new Function(...Object.keys(mock),executable+"\nreturn {executeAssistantTool,verifiedAssistantOlapRows};")(...Object.values(mock));
  const args={
    report_type:"SALES",rows:["CashRegister.Name"],columns:[],measures:["DishDiscountSumInt"],
    from:"2026-10-01",to:"2026-10-29",filters:[{field:"Department.Id",operator:"exclude",values:["r1"]}]
  };
  return {...api,calls,args,context:(selected=["r1"])=>({
    env:{},connection:{ip:"server",port:"8080",login:"user",password:"pw"},
    scope:chain(selected),access
  })};
}
test("AI always includes and validates Department.Id, even if ALL known CHAIN restaurants selected",async()=>{
  const h=harness({payload:[
    {"Department.Id":"r1","CashRegister.Name":"Kassa 1",DishDiscountSumInt:123},
    {"Department.Id":"r2","CashRegister.Name":"Kassa 2",DishDiscountSumInt:456}
  ]});
  const res=await h.executeAssistantTool("run_olap_report",h.args,h.context(["r1","r2"]));
  assert.equal(res.success,true);
  assert.equal(res.departmentRowsVerified,true);
  assert.equal(res.report.length,2);
  const req=h.calls[0].request;
  assert.deepEqual(req.filters["Department.Id"].values,["r1","r2"]);
  assert.equal(req.filters["Department.Id"].filterType,"IncludeValues");
  assert.equal(req.buildSummary,false);
  assert.ok(req.groupByRowFields.includes("Department.Id"));
  assert.equal(req.groupByRowFields.includes("CashRegister.Name"),true);
});
test("AI never sends an unverified or another-restaurant row to the language model",async()=>{
  for(const payload of [
    [{"Department.Id":"r1","DishDiscountSumInt":12},{"Department.Id":"r2","DishDiscountSumInt":999}],
    [{"CashRegister.Name":"Kassa X","DishDiscountSumInt":999}],
    {summary:{"DishDiscountSumInt":999}},
    [{ "Department.Id":null,"DishDiscountSumInt":999}]
  ]){
    const h=harness({payload});
    const res=await h.executeAssistantTool("run_olap_report",h.args,h.context());
    assert.equal(res.success,false);
    assert.match(res.code,/AI_OLAP_SCOPE_/);
    assert.equal(res.report,undefined);
    assert.equal(h.calls.length,1);
  }
});
test("AI refuses CHAIN reports with no Department.Id metadata rather than sending an unscoped request",async()=>{
  const h=harness({fields:["CashRegister.Name","DishDiscountSumInt"]});
  const res=await h.executeAssistantTool("run_olap_report",h.args,h.context(["r1","r2"]));
  assert.equal(res.success,false);
  assert.equal(res.code,"CHAIN_SCOPE_FIELD_MISSING");
  assert.equal(h.calls.length,0);
});
test("AI rejects undocumented server summary fields and permits empty verified datasets",async()=>{
  const h=harness({payload:{rows:[{"Department.Id":"r1",DishDiscountSumInt:42}],summary:{DishDiscountSumInt:424242}}});
  const r=await h.executeAssistantTool("run_olap_report",h.args,h.context());
  assert.equal(r.success,true);
  assert.deepEqual(r.report,[{"Department.Id":"r1",DishDiscountSumInt:42}]);
  const empty=harness({payload:[]});
  const e=await empty.executeAssistantTool("run_olap_report",empty.args,empty.context());
  assert.equal(e.success,true);
  assert.equal(e.report.length,0);
});
test("Invoices and supplier balances enforce CHAIN scope even when full directory selected",()=>{
  assert.match(source,/if\(strictChainScope\)\{/);
  assert.match(source,/supplierBalances\(connection, date, effectiveDepartmentIds, strictChainScope\)/);
  assert.match(source,/filters\[departmentField\]=\{filterType:"IncludeValues"/);
  assert.doesNotMatch(source,/subsetChainScope/);
});
