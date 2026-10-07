function clean(v,max=500){return String(v??"").trim().slice(0,max)}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function now(){return new Date().toISOString()}
function scopeKey(departmentCode){return clean(departmentCode,180)||"*"}
function monthEnd(month){const a=String(month||"").split("-").map(Number);if(a.length!==2||!a[0]||!a[1])return"";const d=new Date(Date.UTC(a[0],a[1],0));return d.toISOString().slice(0,10)}

export async function ensurePayrollAccountingTables(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_accounting_config (
      user_id TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT '*',
      salary_expense_account_id TEXT NOT NULL DEFAULT '',
      salary_expense_account_name TEXT NOT NULL DEFAULT '',
      salary_expense_account_type TEXT NOT NULL DEFAULT '',
      employee_payable_account_id TEXT NOT NULL DEFAULT '',
      employee_payable_account_name TEXT NOT NULL DEFAULT '',
      employee_payable_account_type TEXT NOT NULL DEFAULT '',
      employer_contrib_expense_account_id TEXT NOT NULL DEFAULT '',
      employer_contrib_expense_account_name TEXT NOT NULL DEFAULT '',
      employer_contrib_expense_account_type TEXT NOT NULL DEFAULT '',
      tax_payable_account_id TEXT NOT NULL DEFAULT '',
      tax_payable_account_name TEXT NOT NULL DEFAULT '',
      tax_payable_account_type TEXT NOT NULL DEFAULT '',
      cash_account_id TEXT NOT NULL DEFAULT '',
      cash_account_name TEXT NOT NULL DEFAULT '',
      cash_account_type TEXT NOT NULL DEFAULT '',
      bank_account_id TEXT NOT NULL DEFAULT '',
      bank_account_name TEXT NOT NULL DEFAULT '',
      bank_account_type TEXT NOT NULL DEFAULT '',
      other_payment_account_id TEXT NOT NULL DEFAULT '',
      other_payment_account_name TEXT NOT NULL DEFAULT '',
      other_payment_account_type TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,scope_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_accounting_journal (
      user_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      posting_date TEXT NOT NULL,
      month TEXT NOT NULL DEFAULT '',
      department_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      debit_account_id TEXT NOT NULL,
      debit_account_name TEXT NOT NULL DEFAULT '',
      debit_account_type TEXT NOT NULL DEFAULT '',
      credit_account_id TEXT NOT NULL,
      credit_account_name TEXT NOT NULL DEFAULT '',
      credit_account_type TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'POSTED',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,entry_id),
      UNIQUE(user_id,source_key)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_accounting_journal_period ON sh_accounting_journal(user_id,posting_date,status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_accounting_journal_accounts ON sh_accounting_journal(user_id,debit_account_id,credit_account_id,posting_date)`)
  ]);
}

export async function getPayrollAccountingConfig(db,userId,departmentCode=""){
  await ensurePayrollAccountingTables(db);
  const exact=scopeKey(departmentCode);
  if(exact!=="*"){
    const row=await db.prepare(`SELECT * FROM hr_payroll_accounting_config WHERE user_id=?1 AND scope_key=?2 LIMIT 1`).bind(userId,exact).first();
    if(row)return{...row,effective_scope_key:exact};
  }
  const fallback=await db.prepare(`SELECT * FROM hr_payroll_accounting_config WHERE user_id=?1 AND scope_key='*' LIMIT 1`).bind(userId).first();
  return fallback?{...fallback,effective_scope_key:"*"}:null;
}
export function payrollAccountingReady(config){
  return Boolean(config?.salary_expense_account_id&&config?.employee_payable_account_id&&config?.cash_account_id&&config?.bank_account_id);
}
export async function savePayrollAccountingConfig(db,userId,scope,config,actorId=""){
  await ensurePayrollAccountingTables(db);
  const key=scopeKey(scope),t=now();
  const f=name=>clean(config?.[name],500);
  await db.prepare(`INSERT INTO hr_payroll_accounting_config(
    user_id,scope_key,
    salary_expense_account_id,salary_expense_account_name,salary_expense_account_type,
    employee_payable_account_id,employee_payable_account_name,employee_payable_account_type,
    employer_contrib_expense_account_id,employer_contrib_expense_account_name,employer_contrib_expense_account_type,
    tax_payable_account_id,tax_payable_account_name,tax_payable_account_type,
    cash_account_id,cash_account_name,cash_account_type,
    bank_account_id,bank_account_name,bank_account_type,
    other_payment_account_id,other_payment_account_name,other_payment_account_type,
    updated_by,updated_at
  ) VALUES(
    ?1,?2,
    ?3,?4,?5,
    ?6,?7,?8,
    ?9,?10,?11,
    ?12,?13,?14,
    ?15,?16,?17,
    ?18,?19,?20,
    ?21,?22,?23,
    ?24,?25
  ) ON CONFLICT(user_id,scope_key) DO UPDATE SET
    salary_expense_account_id=excluded.salary_expense_account_id,
    salary_expense_account_name=excluded.salary_expense_account_name,
    salary_expense_account_type=excluded.salary_expense_account_type,
    employee_payable_account_id=excluded.employee_payable_account_id,
    employee_payable_account_name=excluded.employee_payable_account_name,
    employee_payable_account_type=excluded.employee_payable_account_type,
    employer_contrib_expense_account_id=excluded.employer_contrib_expense_account_id,
    employer_contrib_expense_account_name=excluded.employer_contrib_expense_account_name,
    employer_contrib_expense_account_type=excluded.employer_contrib_expense_account_type,
    tax_payable_account_id=excluded.tax_payable_account_id,
    tax_payable_account_name=excluded.tax_payable_account_name,
    tax_payable_account_type=excluded.tax_payable_account_type,
    cash_account_id=excluded.cash_account_id,
    cash_account_name=excluded.cash_account_name,
    cash_account_type=excluded.cash_account_type,
    bank_account_id=excluded.bank_account_id,
    bank_account_name=excluded.bank_account_name,
    bank_account_type=excluded.bank_account_type,
    other_payment_account_id=excluded.other_payment_account_id,
    other_payment_account_name=excluded.other_payment_account_name,
    other_payment_account_type=excluded.other_payment_account_type,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
  .bind(
    userId,key,
    f("salaryExpenseAccountId"),f("salaryExpenseAccountName"),f("salaryExpenseAccountType"),
    f("employeePayableAccountId"),f("employeePayableAccountName"),f("employeePayableAccountType"),
    f("employerContribExpenseAccountId"),f("employerContribExpenseAccountName"),f("employerContribExpenseAccountType"),
    f("taxPayableAccountId"),f("taxPayableAccountName"),f("taxPayableAccountType"),
    f("cashAccountId"),f("cashAccountName"),f("cashAccountType"),
    f("bankAccountId"),f("bankAccountName"),f("bankAccountType"),
    f("otherPaymentAccountId"),f("otherPaymentAccountName"),f("otherPaymentAccountType"),
    clean(actorId,180),t
  ).run();
  return getPayrollAccountingConfig(db,userId,key==="*"?"":key);
}
async function upsertPair(db,{userId,sourceKey,sourceType,sourceId,postingDate,month,departmentCode,description,debit,credit,amount,metadata}){
  await ensurePayrollAccountingTables(db);
  const a=money(amount),t=now();
  if(a<=0){
    await db.prepare(`UPDATE sh_accounting_journal SET status='CANCELLED',updated_at=?3 WHERE user_id=?1 AND source_key=?2`).bind(userId,sourceKey,t).run();
    return null;
  }
  const entryId=crypto.randomUUID();
  await db.prepare(`INSERT INTO sh_accounting_journal(
    user_id,entry_id,source_key,source_type,source_id,posting_date,month,department_code,description,
    debit_account_id,debit_account_name,debit_account_type,
    credit_account_id,credit_account_name,credit_account_type,
    amount,status,metadata_json,created_at,updated_at
  ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'POSTED',?17,?18,?18)
  ON CONFLICT(user_id,source_key) DO UPDATE SET
    source_type=excluded.source_type,source_id=excluded.source_id,posting_date=excluded.posting_date,month=excluded.month,
    department_code=excluded.department_code,description=excluded.description,
    debit_account_id=excluded.debit_account_id,debit_account_name=excluded.debit_account_name,debit_account_type=excluded.debit_account_type,
    credit_account_id=excluded.credit_account_id,credit_account_name=excluded.credit_account_name,credit_account_type=excluded.credit_account_type,
    amount=excluded.amount,status='POSTED',metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
  .bind(
    userId,entryId,sourceKey,clean(sourceType,80),clean(sourceId,180),clean(postingDate,10),clean(month,7),clean(departmentCode,180),clean(description,500),
    clean(debit?.id,180),clean(debit?.name,300),clean(debit?.type,120),
    clean(credit?.id,180),clean(credit?.name,300),clean(credit?.type,120),
    a,JSON.stringify(metadata||{}).slice(0,5000),t
  ).run();
  return db.prepare(`SELECT * FROM sh_accounting_journal WHERE user_id=?1 AND source_key=?2 LIMIT 1`).bind(userId,sourceKey).first();
}
export async function syncOvertimeAccrualPosting(db,{userId,month,employeeId,employeeName,departmentCode,amount,payableMinutes,extraDayEquivalent}){
  const config=await getPayrollAccountingConfig(db,userId,departmentCode);
  const sourceKey=`HR_OT_ACCRUAL:${month}:${employeeId}`;
  if(!payrollAccountingReady(config)){
    return{posted:false,reason:"ACCOUNTING_NOT_CONFIGURED",sourceKey,configScope:config?.effective_scope_key||null};
  }
  const row=await upsertPair(db,{
    userId,sourceKey,sourceType:"HR_OVERTIME_ACCRUAL",sourceId:employeeId,postingDate:monthEnd(month),month,departmentCode,
    description:`Начисление доп. часов · ${clean(employeeName,220)} · ${month}`,
    debit:{id:config.salary_expense_account_id,name:config.salary_expense_account_name,type:config.salary_expense_account_type},
    credit:{id:config.employee_payable_account_id,name:config.employee_payable_account_name,type:config.employee_payable_account_type},
    amount,metadata:{employeeId,employeeName,payableMinutes,extraDayEquivalent,configScope:config.effective_scope_key}
  });
  return{posted:Boolean(row),entry:row,configScope:config.effective_scope_key};
}
export async function syncOvertimePaymentPosting(db,{userId,paymentId,employeeId,employeeName,departmentCode,paymentDate,amount,paymentMethod,reference,note}){
  const config=await getPayrollAccountingConfig(db,userId,departmentCode);
  if(!payrollAccountingReady(config))return{posted:false,reason:"ACCOUNTING_NOT_CONFIGURED",configScope:config?.effective_scope_key||null};
  let out={id:config.cash_account_id,name:config.cash_account_name,type:config.cash_account_type};
  if(String(paymentMethod).toUpperCase()==="BANK")out={id:config.bank_account_id,name:config.bank_account_name,type:config.bank_account_type};
  else if(String(paymentMethod).toUpperCase()==="OTHER"&&config.other_payment_account_id)out={id:config.other_payment_account_id,name:config.other_payment_account_name,type:config.other_payment_account_type};
  if(!out.id)return{posted:false,reason:"PAYMENT_ACCOUNT_NOT_CONFIGURED",configScope:config.effective_scope_key};
  const row=await upsertPair(db,{
    userId,sourceKey:`HR_OT_PAYMENT:${paymentId}`,sourceType:"HR_OVERTIME_PAYMENT",sourceId:paymentId,postingDate:paymentDate,month:String(paymentDate).slice(0,7),departmentCode,
    description:`Выплата доп. часов · ${clean(employeeName,220)}${reference?` · ${clean(reference,100)}`:""}`,
    debit:{id:config.employee_payable_account_id,name:config.employee_payable_account_name,type:config.employee_payable_account_type},
    credit:out,amount,metadata:{employeeId,employeeName,paymentMethod,reference,note,configScope:config.effective_scope_key}
  });
  return{posted:Boolean(row),entry:row,configScope:config.effective_scope_key};
}
export async function cancelAccountingSource(db,userId,sourceKey){
  await ensurePayrollAccountingTables(db);
  const t=now();
  await db.prepare(`UPDATE sh_accounting_journal SET status='CANCELLED',updated_at=?3 WHERE user_id=?1 AND source_key=?2`).bind(userId,sourceKey,t).run();
}
export async function listAccountingJournal(db,{userId,from,to,departmentCodes=[],accountId=""}){
  await ensurePayrollAccountingTables(db);
  const args=[userId,from,to],filters=["user_id=?","posting_date>=?","posting_date<=?","status='POSTED'"];
  let pos=4;
  const deps=(departmentCodes||[]).map(x=>clean(x,180)).filter(Boolean);
  if(deps.length){filters.push(`department_code IN (${deps.map(()=>"?").join(",")})`);args.push(...deps);pos+=deps.length}
  if(accountId){filters.push(`(debit_account_id=? OR credit_account_id=?)`);args.push(clean(accountId,180),clean(accountId,180));}
  const sql=`SELECT * FROM sh_accounting_journal WHERE ${filters.join(" AND ")} ORDER BY posting_date,created_at`;
  const r=await db.prepare(sql).bind(...args).all();
  return r.results||[];
}
