(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search),employeeId=params.get('id')||'';
  let state=null,busy=false;

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  async function api(url,opt={}){
    const t=await token(),fetcher=window.SH_IikoContext?.fetchWithTimeout||fetch;
    const options={...opt,headers:{Authorization:`Bearer ${t}`,Accept:'application/json',...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}};
    const r=await fetcher(url,options,60000),j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
    if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j;
  }
  function setStatus(text,kind=''){const el=$('hepAttendanceRuleSource');if(!el)return;el.textContent=text;el.className=`hep-source ${kind||'smart'}`}
  function render(){
    const rule=state?.attendanceRule||{},shift=rule.effectiveShiftType==='NIGHT'?'NIGHT':'DAY',source=rule.source==='EMPLOYEE'?'EMPLOYEE':'ROLE';
    if($('hepAttendanceNorm'))$('hepAttendanceNorm').textContent=((Number(rule.roleDailyNormMinutes||480)/60).toFixed(2).replace(/\.00$/,''))+' ч';
    if($('hepAttendanceShiftOverride'))$('hepAttendanceShiftOverride').value=rule.shiftTypeOverride||'';
    if($('hepAttendanceWindow'))$('hepAttendanceWindow').textContent=shift==='NIGHT'?'12:00 → 11:59 следующего дня':'05:00 → 04:59 следующего дня';
    setStatus(source==='EMPLOYEE'?'Индивидуально':'По должности',source==='EMPLOYEE'?'individual':'smart');
  }
  async function load(){
    if(!employeeId||!$('hepAttendanceRuleSave'))return;
    try{state=await api(`/api/hr/employee-schedule?id=${encodeURIComponent(employeeId)}`);render()}catch(e){console.error('[HR-EMPLOYEE-ATTENDANCE]',e);setStatus('Ошибка','error')}
  }
  async function save(){
    if(busy||!employeeId)return;
    try{
      busy=true;$('hepAttendanceRuleSave').disabled=true;setStatus('Сохраняем…','smart');
      await api('/api/hr/employee-schedule',{method:'POST',body:JSON.stringify({action:'saveAttendanceRule',employeeId,shiftTypeOverride:$('hepAttendanceShiftOverride')?.value||''})});
      await load();
    }catch(e){console.error(e);setStatus('Ошибка','error')}
    finally{busy=false;$('hepAttendanceRuleSave').disabled=false}
  }
  function bind(){
    $('hepAttendanceRuleSave')?.addEventListener('click',save);
    $('hepAttendanceShiftOverride')?.addEventListener('change',function(){
      const inherited=state?.attendanceRule?.roleShiftType||'DAY',shift=this.value||inherited;
      if($('hepAttendanceWindow'))$('hepAttendanceWindow').textContent=shift==='NIGHT'?'12:00 → 11:59 следующего дня':'05:00 → 04:59 следующего дня';
    });
  }
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();