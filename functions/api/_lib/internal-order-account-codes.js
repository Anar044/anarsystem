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
