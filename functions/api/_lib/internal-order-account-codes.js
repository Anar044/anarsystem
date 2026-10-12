// Validates user-configured OUTGOING invoice accounting codes.
// These are *account codes*, not human-readable account names or warehouse IDs.
// The iiko server is authoritative on whether a code exists/permits the posting.
const trim=x=>String(x??"").trim();
export function validateInternalAccountCodes(raw){
  const revenueAccountCode=trim(raw?.revenueAccountCode);
  const expenseAccountCode=trim(raw?.expenseAccountCode);
  const good=x=>!x||/^[\p{L}\p{N}_.\/-]{1,40}$/u.test(x);
  if(!good(revenueAccountCode)||!good(expenseAccountCode))
    return {valid:false,code:"INVALID_ACCOUNT_CODE",message:"Код счёта может содержать буквы, цифры, точку, дефис, подчёркивание или слэш (максимум 40 символов)."};
  if(Boolean(revenueAccountCode)!==Boolean(expenseAccountCode))
    return {valid:false,code:"INCOMPLETE_ACCOUNT_PAIR",message:"Нужно указать оба счёта или оставить оба пустыми для настроек iiko по умолчанию."};
  return {valid:true,revenueAccountCode,expenseAccountCode,
    usesIikoDefaults:!revenueAccountCode&&!expenseAccountCode};
}

export function normalizeInternalIikoAccounts(payload){
  const rows=Array.isArray(payload)?payload:
    [payload?.accounts,payload?.data,payload?.items,payload?.result,payload?.results].find(Array.isArray)||[];
  const byCode=new Map();
  for(const row of rows){
    if(!row||typeof row!=="object"||row.deleted===true)continue;
    const code=trim(row.code),name=trim(row.name),type=trim(row.type||row.accountType);
    if(!code||!name||!/^[\p{L}\p{N}_.\/-]{1,40}$/u.test(code))continue;
    if(!byCode.has(code))byCode.set(code,{code,name,type});
  }
  return [...byCode.values()].sort((a,b)=>a.code.localeCompare(b.code,"ru",{numeric:true}));
}
