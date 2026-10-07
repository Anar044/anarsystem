import { loadRequestIikoState } from "../iiko/_lib/user-state.js";
import { resolveHrRestaurantScope } from "./_lib/restaurant-scope.js";
import { hrAccessForUser, requireCapability } from "./_lib/timesheet-adjustments.js";
import { ensurePayrollAccountingTables, getPayrollAccountingConfig, savePayrollAccountingConfig, getPayrollBankAccounts, savePayrollBankAccounts } from "./_lib/payroll-accounting.js";
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
    let bankAccounts=await getPayrollBankAccounts(env.DB,state.user.id,scopeKey==="*"?"":scopeKey);
    if(!bankAccounts.length&&config?.bank_account_id){
      bankAccounts=[{account_id:config.bank_account_id,account_name:config.bank_account_name||"",account_type:config.bank_account_type||"",is_default:1,effective_scope_key:config.effective_scope_key||scopeKey}];
    }
    return json({
      success:true,
      scope:{scopeKey,mode:scope?.mode||null,selectedDepartmentCodes:scope?.selectedDepartmentCodes||[],selectedDepartmentIds:scope?.selectedDepartmentIds||[]},
      config:dto(config),
      bankAccounts:bankAccounts.map(x=>({id:x.account_id,name:x.account_name,type:x.account_type,isDefault:Boolean(x.is_default),effectiveScopeKey:x.effective_scope_key||scopeKey})),
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
    const beforeConfig=dto(await getPayrollAccountingConfig(env.DB,state.user.id,selectedScope==="*"?"":selectedScope));
    const beforeBanks=(await getPayrollBankAccounts(env.DB,state.user.id,selectedScope==="*"?"":selectedScope)).map(x=>({id:x.account_id,name:x.account_name,type:x.account_type,isDefault:Boolean(x.is_default)}));
    const banks=(Array.isArray(body.bankAccounts)?body.bankAccounts:[]).map(x=>({id:clean(x?.id,180),name:clean(x?.name,300),type:clean(x?.type,120),isDefault:Boolean(x?.isDefault)})).filter(x=>x.id);
    const defaultBank=banks.find(x=>x.isDefault)||banks[0]||null;
    const configPayload={...(body.config||{}),bankAccountId:defaultBank?.id||"",bankAccountName:defaultBank?.name||"",bankAccountType:defaultBank?.type||""};
    const cfg=await savePayrollAccountingConfig(env.DB,state.user.id,selectedScope,configPayload,state.user.id);
    const savedBanks=await savePayrollBankAccounts(env.DB,state.user.id,selectedScope,banks,state.user.id);
    const after=dto(cfg),afterBanks=savedBanks.map(x=>({id:x.account_id,name:x.account_name,type:x.account_type,isDefault:Boolean(x.is_default)}));
    await logAuditEvent({
      request,env,connection:state.state?.iikoConnection||null,action:"UPDATE",entityType:"HR_PAYROLL_ACCOUNTING_CONFIG",
      entityId:selectedScope,entityLabel:"Настройки бухгалтерии Payroll",before:{config:beforeConfig,bankAccounts:beforeBanks},after:{config:after,bankAccounts:afterBanks},
      restaurantIds:scope?.selectedDepartmentIds||[],metadata:{scopeKey:selectedScope}
    });
    return json({success:true,scope:{scopeKey:selectedScope},config:after,bankAccounts:afterBanks,access});
  }catch(e){console.error("[HR-PAYROLL-ACCOUNTING-POST]",e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
