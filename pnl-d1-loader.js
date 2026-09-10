(function(){
  'use strict';
  const buttonId='load';
  let busy=false;
  function patchStorage(state){
    const connection=state?.connection||null;
    const identity=state?.identity||null;
    if(!connection)return;
    const departments=[
      ...(Array.isArray(identity?.departmentIds)?identity.departmentIds:[]),
      ...(Array.isArray(connection?.departmentIds)?connection.departmentIds:[]),
      ...(Array.isArray(identity?.departments)?identity.departments.map(x=>x?.id):[]),
      identity?.organizationId,
      connection?.organizationId
    ].map(String).map(x=>x.trim()).filter(x=>x&&x!=='undefined'&&x!=='null');
    const merged={...connection,departmentIds:[...new Set(departments)]};
    const storage=window.localStorage;
    const original=Storage.prototype.getItem;
    if(!Storage.prototype.__pnlD1Patched){
      Storage.prototype.getItem=function(key){
        if(this===storage&&String(key)==='iikoConnection'&&window.__PNL_D1_CONNECTION){
          return JSON.stringify(window.__PNL_D1_CONNECTION);
        }
        return original.call(this,key);
      };
      Storage.prototype.__pnlD1Patched=true;
    }
    window.__PNL_D1_CONNECTION=merged;
  }
  async function ensure(){
    if(!window.SH_IikoContext?.get)throw new Error('Единый iiko-контекст ещё не готов');
    const state=await window.SH_IikoContext.get(true);
    patchStorage(state);
    return state;
  }
  function boot(){
    const btn=document.getElementById(buttonId);
    if(!btn)return setTimeout(boot,100);
    btn.addEventListener('click',async function(event){
      if(busy)return;
      busy=true;
      event.preventDefault();
      event.stopImmediatePropagation();
      try{
        await ensure();
        if(typeof btn.onclick==='function')await btn.onclick.call(btn,event);
      }catch(e){
        const status=document.getElementById('pnl-status');
        const message=document.getElementById('message');
        if(status)status.textContent='Ошибка подключения';
        if(message){message.style.display='block';message.textContent=e?.message||String(e);}
      }finally{busy=false;}
    },true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
