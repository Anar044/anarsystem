import { loadRequestIikoState } from "../iiko/_lib/user-state.js";
import { resolveHrRestaurantScope } from "./_lib/restaurant-scope.js";
import { hrAccessForUser, requireCapability } from "./_lib/timesheet-adjustments.js";
import { ensurePayrollAccountingTables, getPayrollAccountingConfig, savePayrollAccountingConfig } from "./_lib/payroll-accounting.js";
import { logAuditEvent } from "../_lib/audit-log.js";

function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...cors()}})}
function clean(v,max=500){return String(v??"").trim().slice(0,max)}
function currentScopeKey(scope){
  const codes=[...new Set((scope?.selectedDepartmentCodes||[]).map(x=>clean(x,180)).filter(Boolean))];
  if(codes.length===1)return codes[0];
  return"*";
}
function dto(row){
  if(!row)return null;
  return{
    scopeKey:row.scope_key||row.effective_scope_key||"*",
    effectiveScopeKey:row.effective_scope_key||row.scope_key||"*",
    salaryExpense:{id:row.salary_expense_account_id||"",name:row.salary_expense_account_name||"",type:row.salary_expense_account_type||""},
    employeePayable:{id:row.employee_payable_account_id||"",name:row.employee_payable_account_name||"",type:row.employee_payable_account_type||""},
    employerContribExpense:{id:row.employer_contrib_expense_account_id||"",name:row.employer_contrib_expense_account_name||"",type:row.employer_contrib_expense_account_type||""},
    taxPayable:{id:row.tax_payable_account_id||"",name:row.tax_payable_account_name||"",type:row.tax_payable_account_type||""},
    cash:{id:row.cash_account_id||"",name:row.cash_account_name||"",type:row.cash_account_type||""},
    bank:{id:row.bank_account_id||"",name:row.bank_account_name||"",type:row.bank_account_type||""},
    otherPayment:{id:row.other_payment_account_id||"",name:row.other_payment_account_name||"",type:row.other_payment_account_type||""},
    updatedAt:row.updated_at||""
  };
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:"Требуется авторизация"},401);
    requireCapability(state.user,"canViewPayroll");await ensurePayrollAccountingTables(env.DB);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),scopeKey=currentScopeKey(scope);
    const config=await getPayrollAccountingConfig(env.DB,state.user.id,scopeKey==="*"?"":scopeKey);
    return json({
      success:true,
      scope:{scopeKey,mode:scope?.mode||null,selectedDepartmentCodes:scope?.selectedDepartmentCodes||[],selectedDepartmentIds:scope?.selectedDepartmentIds||[]},
      config:dto(config),
      access:hrAccessForUser(state.user)
    });
  }catch(e){console.error("[HR-PAYROLL-ACCOUNTING-GET]",e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:"Требуется авторизация"},401);
    const access=requireCapability(state.user,"canConfigurePayrollAccounting");await ensurePayrollAccountingTables(env.DB);
    const body=await request.json().catch(()=>({})),scope=await resolveHrRestaurantScope(request,env,state.user.id),scopeKey=currentScopeKey(scope);
    const selectedScope=clean(body.scopeKey,180)||scopeKey;
    if(selectedScope!=="*"&&scopeKey!=="*"&&selectedScope!==scopeKey)return json({success:false,message:"Нельзя сохранить настройки для другого подразделения"},403);
    const before=dto(await getPayrollAccountingConfig(env.DB,state.user.id,selectedScope==="*"?"":selectedScope));
    const cfg=await savePayrollAccountingConfig(env.DB,state.user.id,selectedScope,body.config||{},state.user.id);
    const after=dto(cfg);
    await logAuditEvent({
      request,env,connection:state.state?.iikoConnection||null,action:"UPDATE",entityType:"HR_PAYROLL_ACCOUNTING_CONFIG",
      entityId:selectedScope,entityLabel:"Настройки бухгалтерии Payroll",before,after,
      restaurantIds:scope?.selectedDepartmentIds||[],metadata:{scopeKey:selectedScope}
    });
    return json({success:true,scope:{scopeKey:selectedScope},config:after,access});
  }catch(e){console.error("[HR-PAYROLL-ACCOUNTING-POST]",e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
