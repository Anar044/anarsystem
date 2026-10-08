import { loadRequestIikoState, privateConnection } from "../iiko/_lib/user-state.js";
import { resolveHrRestaurantScope, filterEmployeesByScope } from "./_lib/restaurant-scope.js";
import { hrAccessForUser, requireCapability } from "./_lib/timesheet-adjustments.js";
import { logAuditEvent } from "../_lib/audit-log.js";
import { getPayrollAccountingConfig, getPayrollBankAccounts, payrollAccountingReady, syncOvertimePaymentPosting, cancelAccountingSource } from "./_lib/payroll-accounting.js";

function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...cors()}})}
function clean(v,max=2000){return String(v??"").trim().slice(0,max)}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function monthOnly(v){const s=clean(v,7);return /^\d{4}-\d{2}$/.test(s)?s:""}
function dateOnly(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:""}
function monthBounds(month){const a=month.split("-").map(Number),last=new Date(Date.UTC(a[0],a[1],0)).getUTCDate();return{from:month+"-01",to:month+"-"+String(last).padStart(2,"0")}}
function actorLabel(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id||"Пользователь",180)}
function chunkList(values,size=50){const out=[];for(let i=0;i<(values||[]).length;i+=size)out.push(values.slice(i,i+size));return out}

async function ensure(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS hr_overtime_payroll_accruals (user_id TEXT NOT NULL,month TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,payable_minutes REAL NOT NULL DEFAULT 0,extra_day_equivalent REAL NOT NULL DEFAULT 0,source_version TEXT NOT NULL DEFAULT 'PAYROLL_V2',calculated_at TEXT NOT NULL,PRIMARY KEY(user_id,month,iiko_employee_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_overtime_payroll_accruals_employee ON hr_overtime_payroll_accruals(user_id,iiko_employee_id,month)"),
    db.prepare("CREATE TABLE IF NOT EXISTS hr_overtime_payments (user_id TEXT NOT NULL,payment_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,payment_date TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,payment_method TEXT NOT NULL DEFAULT 'CASH',reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'POSTED',actor_id TEXT NOT NULL DEFAULT '',actor_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,payment_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_overtime_payments_employee ON hr_overtime_payments(user_id,iiko_employee_id,payment_date,status)"),
    db.prepare("CREATE TABLE IF NOT EXISTS hr_overtime_payment_sources (user_id TEXT NOT NULL,payment_id TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',account_name TEXT NOT NULL DEFAULT '',account_type TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(user_id,payment_id))")
  ]);
}
async function scopedEmployees(request,env,userId){
  const scope=await resolveHrRestaurantScope(request,env,userId);
  const r=await env.DB.prepare("SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE").bind(userId).all();
  const employees=filterEmployeesByScope(r.results||[],scope).filter(x=>!Number(x.is_deleted)).map(e=>({id:String(e.iiko_employee_id),code:e.employee_code||"",name:[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(" ")||e.display_name||e.employee_code||String(e.iiko_employee_id),roleCode:e.role_code||"",roleName:e.role_name||e.role_code||"",departmentCode:e.department_code||""}));
  return{scope,employees};
}
async function snapshot(request,env,userId,month){
  const b=monthBounds(month),scoped=await scopedEmployees(request,env,userId),employees=scoped.employees,ids=employees.map(x=>x.id),accruals=[],payments=[];
  for(const part of chunkList(ids,50)){
    if(!part.length)continue;
    const qs=part.map(()=>"?").join(",");
    const aSql="SELECT month,iiko_employee_id,amount,payable_minutes,extra_day_equivalent,calculated_at FROM hr_overtime_payroll_accruals WHERE user_id=? AND iiko_employee_id IN ("+qs+") AND month<=? ORDER BY month";
    const pSql="SELECT p.payment_id,p.iiko_employee_id,p.payment_date,p.amount,p.payment_method,p.reference,p.note,p.status,p.actor_label,p.created_at,p.updated_at,s.account_id AS payment_account_id,s.account_name AS payment_account_name,s.account_type AS payment_account_type FROM hr_overtime_payments p LEFT JOIN hr_overtime_payment_sources s ON s.user_id=p.user_id AND s.payment_id=p.payment_id WHERE p.user_id=? AND p.iiko_employee_id IN ("+qs+") AND p.payment_date<=? ORDER BY p.payment_date,p.created_at";
    const pair=await env.DB.batch([env.DB.prepare(aSql).bind(userId,...part,month),env.DB.prepare(pSql).bind(userId,...part,b.to)]);
    accruals.push(...(pair[0].results||[]));payments.push(...(pair[1].results||[]));
  }
  const by=new Map(employees.map(e=>[e.id,{...e,openingAccrued:0,openingPaid:0,openingDebt:0,currentAccrued:0,currentPaid:0,closingDebt:0,currentPayableMinutes:0,currentExtraDays:0,payments:[]}]));
  for(const a of accruals){const e=by.get(String(a.iiko_employee_id));if(!e)continue;if(String(a.month)<month)e.openingAccrued+=money(a.amount);else if(String(a.month)===month){e.currentAccrued+=money(a.amount);e.currentPayableMinutes+=Number(a.payable_minutes||0);e.currentExtraDays+=Number(a.extra_day_equivalent||0)}}
  for(const p of payments){if(String(p.status||"POSTED")!=="POSTED")continue;const e=by.get(String(p.iiko_employee_id));if(!e)continue;const item={id:p.payment_id,date:p.payment_date,amount:money(p.amount),method:p.payment_method||"CASH",reference:p.reference||"",note:p.note||"",actorLabel:p.actor_label||"",createdAt:p.created_at||"",accountId:p.payment_account_id||"",accountName:p.payment_account_name||"",accountType:p.payment_account_type||""};if(String(p.payment_date)<b.from)e.openingPaid+=item.amount;else if(String(p.payment_date)<=b.to){e.currentPaid+=item.amount;e.payments.push(item)}}
  const rows=[...by.values()].map(e=>{e.openingAccrued=money(e.openingAccrued);e.openingPaid=money(e.openingPaid);e.openingDebt=money(Math.max(0,e.openingAccrued-e.openingPaid));e.currentAccrued=money(e.currentAccrued);e.currentPaid=money(e.currentPaid);e.closingDebt=money(Math.max(0,e.openingDebt+e.currentAccrued-e.currentPaid));e.currentPayableMinutes=Math.round(Number(e.currentPayableMinutes||0));e.currentExtraDays=Math.round(Number(e.currentExtraDays||0)*100)/100;return e});
  const depPaymentAccounts=new Map();
  for(const dep of [...new Set(rows.map(x=>String(x.departmentCode||""))) ]){
    const config=await getPayrollAccountingConfig(env.DB,userId,dep),banks=await getPayrollBankAccounts(env.DB,userId,dep);
    const normalizedBanks=banks.length?banks.map(x=>({id:x.account_id,name:x.account_name,type:x.account_type,isDefault:Boolean(x.is_default)})):(config?.bank_account_id?[{id:config.bank_account_id,name:config.bank_account_name||"",type:config.bank_account_type||"",isDefault:true}]:[]);
    depPaymentAccounts.set(dep,{
      cash:config?.cash_account_id?{id:config.cash_account_id,name:config.cash_account_name||"",type:config.cash_account_type||""}:null,
      banks:normalizedBanks,
      other:config?.other_payment_account_id?{id:config.other_payment_account_id,name:config.other_payment_account_name||"",type:config.other_payment_account_type||""}:null
    });
  }
  for(const row of rows)row.paymentAccounts=depPaymentAccounts.get(String(row.departmentCode||""))||{cash:null,banks:[],other:null};
  const sum=k=>money(rows.reduce((s,x)=>s+Number(x[k]||0),0));
  return{success:true,month,period:b,access:null,restaurantScope:scoped.scope?{mode:scoped.scope.mode,departmentIds:scoped.scope.selectedDepartmentIds,departmentCodes:scoped.scope.selectedDepartmentCodes}:null,summary:{employees:rows.length,withDebt:rows.filter(x=>x.closingDebt>0).length,openingDebt:sum("openingDebt"),accrued:sum("currentAccrued"),paid:sum("currentPaid"),closingDebt:sum("closingDebt")},rows};
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:"Требуется авторизация"},401);
    requireCapability(state.user,"canViewPayroll");await ensure(env.DB);
    const url=new URL(request.url),month=monthOnly(url.searchParams.get("month"));if(!month)return json({success:false,message:"Укажите месяц YYYY-MM"},400);
    const out=await snapshot(request,env,state.user.id,month);out.access=hrAccessForUser(state.user);return json(out);
  }catch(e){console.error("[HR-OVERTIME-SETTLEMENTS-GET]",e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:"Требуется авторизация"},401);
    const access=requireCapability(state.user,"canSettlePayroll");await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40).toUpperCase(),month=monthOnly(body.month);if(!month)return json({success:false,message:"Укажите месяц YYYY-MM"},400);
    const userId=state.user.id,b=monthBounds(month),actorId=clean(state.user.id,180),actor=actorLabel(state.user),t=new Date().toISOString(),connection=privateConnection(state.state);
    if(action==="RECORD_PAYMENT"){
      const employeeId=clean(body.employeeId,180),paymentDate=dateOnly(body.paymentDate),amount=money(body.amount),method=clean(body.paymentMethod||"CASH",30).toUpperCase(),bankAccountId=clean(body.bankAccountId,180),reference=clean(body.reference,180),note=clean(body.note,1000);
      if(!employeeId||!paymentDate||amount<=0)return json({success:false,message:"Укажите сотрудника, дату и сумму выплаты"},400);
      if(paymentDate<b.from||paymentDate>b.to)return json({success:false,message:"Дата выплаты должна относиться к выбранному месяцу"},400);
      if(!["CASH","BANK","OTHER"].includes(method))return json({success:false,message:"Некорректный способ выплаты"},400);
      const before=await snapshot(request,env,userId,month),row=before.rows.find(x=>String(x.id)===employeeId);
      if(!row)return json({success:false,message:"Сотрудник не найден в выбранном подразделении"},404);
      if(amount>Number(row.closingDebt||0)+.009)return json({success:false,message:"Сумма выплаты превышает долг "+Number(row.closingDebt||0).toFixed(2)+" AZN"},409);
      const accounting=await getPayrollAccountingConfig(env.DB,userId,row.departmentCode||"");
      if(!payrollAccountingReady(accounting))return json({success:false,code:"PAYROLL_ACCOUNTING_NOT_CONFIGURED",message:"Сначала настройте реальные счета Payroll: расходы на зарплату, задолженность сотрудникам и кассу."},409);
      let selectedPaymentAccount=null;
      if(method==="BANK"){
        const banks=await getPayrollBankAccounts(env.DB,userId,row.departmentCode||"");
        const legacy=!banks.length&&accounting?.bank_account_id?[{account_id:accounting.bank_account_id,account_name:accounting.bank_account_name||"",account_type:accounting.bank_account_type||"",is_default:1}]:[];
        const list=banks.length?banks:legacy,selected=list.find(x=>String(x.account_id)===bankAccountId)||(bankAccountId?null:list.find(x=>Number(x.is_default))||list[0]);
        if(!selected)return json({success:false,code:"PAYROLL_BANK_ACCOUNT_REQUIRED",message:"Выберите банковский счёт, с которого выполняется выплата."},409);
        selectedPaymentAccount={id:selected.account_id,name:selected.account_name||"",type:selected.account_type||""};
      }else if(method==="CASH"){
        selectedPaymentAccount={id:accounting.cash_account_id,name:accounting.cash_account_name||"",type:accounting.cash_account_type||""};
      }else if(method==="OTHER"){
        if(!accounting.other_payment_account_id)return json({success:false,code:"PAYROLL_OTHER_ACCOUNT_NOT_CONFIGURED",message:"Для способа «Другое» не настроен счёт списания."},409);
        selectedPaymentAccount={id:accounting.other_payment_account_id,name:accounting.other_payment_account_name||"",type:accounting.other_payment_account_type||""};
      }
      const id=crypto.randomUUID();
      await env.DB.prepare("INSERT INTO hr_overtime_payments(user_id,payment_id,iiko_employee_id,payment_date,amount,payment_method,reference,note,status,actor_id,actor_label,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'POSTED',?9,?10,?11,?11)").bind(userId,id,employeeId,paymentDate,amount,method,reference,note,actorId,actor,t).run();
      await env.DB.prepare("INSERT INTO hr_overtime_payment_sources(user_id,payment_id,account_id,account_name,account_type,created_at) VALUES(?1,?2,?3,?4,?5,?6)").bind(userId,id,selectedPaymentAccount?.id||"",selectedPaymentAccount?.name||"",selectedPaymentAccount?.type||"",t).run();
      try{
        const posting=await syncOvertimePaymentPosting(env.DB,{userId,paymentId:id,employeeId,employeeName:row.name,departmentCode:row.departmentCode||"",paymentDate,amount,paymentMethod:method,paymentAccount:selectedPaymentAccount,reference,note});
        if(!posting?.posted)throw new Error(posting?.reason||"Не удалось создать бухгалтерскую проводку");
      }catch(error){
        await env.DB.batch([
          env.DB.prepare("DELETE FROM hr_overtime_payment_sources WHERE user_id=?1 AND payment_id=?2").bind(userId,id),
          env.DB.prepare("DELETE FROM hr_overtime_payments WHERE user_id=?1 AND payment_id=?2").bind(userId,id)
        ]);
        throw error;
      }
      const after=await snapshot(request,env,userId,month);after.access=access;
      await logAuditEvent({request,env,connection,action:"CREATE",entityType:"HR_OVERTIME_PAYMENT",entityId:id,entityLabel:"Выплата доп. часов · "+row.name,before:null,after:{employeeId,paymentDate,amount,method,paymentAccount:selectedPaymentAccount,reference,note},restaurantIds:after.restaurantScope?.departmentIds||[],metadata:{month}});
      return json(after);
    }
    if(action==="CANCEL_PAYMENT"){
      const paymentId=clean(body.paymentId,180),reason=clean(body.reason,1000);if(!paymentId)return json({success:false,message:"Не указана выплата"},400);
      const old=await env.DB.prepare("SELECT * FROM hr_overtime_payments WHERE user_id=?1 AND payment_id=?2 AND status='POSTED' LIMIT 1").bind(userId,paymentId).first();
      if(!old)return json({success:false,message:"Выплата не найдена или уже отменена"},404);
      const before=await snapshot(request,env,userId,month);if(!before.rows.some(x=>String(x.id)===String(old.iiko_employee_id)))return json({success:false,message:"Выплата относится к сотруднику вне выбранного подразделения"},403);
      const note=reason?String(old.note||"")+(old.note?" · ":"")+"Отмена: "+reason:String(old.note||"");
      await env.DB.prepare("UPDATE hr_overtime_payments SET status='CANCELLED',note=?3,actor_id=?4,actor_label=?5,updated_at=?6 WHERE user_id=?1 AND payment_id=?2").bind(userId,paymentId,note,actorId,actor,t).run();
      await cancelAccountingSource(env.DB,userId,"HR_OT_PAYMENT:"+paymentId);
      const after=await snapshot(request,env,userId,month);after.access=access;
      await logAuditEvent({request,env,connection,action:"DELETE",entityType:"HR_OVERTIME_PAYMENT",entityId:paymentId,entityLabel:"Отмена выплаты дополнительных часов",before:old,after:{status:"CANCELLED",reason},restaurantIds:after.restaurantScope?.departmentIds||[],metadata:{month}});
      return json(after);
    }
    return json({success:false,message:"Неизвестное действие"},400);
  }catch(e){console.error("[HR-OVERTIME-SETTLEMENTS-POST]",e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
