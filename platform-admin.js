(()=>{
'use strict';
const $=id=>document.getElementById(id);
let apiToken='',busy=false;
function notify(message,error=false){
  const el=$('message');el.hidden=!message;el.textContent=message||'';
  el.style.borderColor=error?'#b65464':'#395061';
}
function text(tag,value,className=''){
  const el=document.createElement(tag);el.textContent=String(value??'');
  if(className)el.className=className;
  return el;
}
async function initSession(){
  const sb=await window.SHAuth?.createClient?.();
  if(!sb)throw new Error('Не удалось открыть авторизацию.');
  const {data,error}=await sb.auth.getSession();
  if(error)throw error;
  if(!data?.session?.access_token){
    location.replace('/login.html?next='+encodeURIComponent('/platform-admin.html'));
    return false;
  }
  apiToken=data.session.access_token;
  return true;
}
async function call(method,body){
  if(!apiToken)throw new Error('Нет сессии.');
  const response=await fetch('/api/platform/organizations',{
    method,headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json',Accept:'application/json'},
    body:body?JSON.stringify(body):undefined,cache:'no-store'
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload.success===false)throw new Error(payload.message||'HTTP '+response.status);
  return payload;
}
function buildButton(label,handler,style='secondary'){
  const button=text('button',label,style);button.type='button';button.onclick=handler;return button;
}
async function perform(callback){
  if(busy)return;busy=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  notify('');
  try{await callback()}catch(error){notify(error?.message||'Неизвестная ошибка',true)}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
function showInvitation(link,alreadyRegistered){
  const area=$('inviteResult'),input=$('inviteLink');
  if(!link){
    area.hidden=true;
    notify(alreadyRegistered?'Пользователь уже зарегистрирован. Для него новое приглашение не требуется.':'Приглашение не создано.');
    return;
  }
  input.value=link;area.hidden=false;
  notify('Приглашение создано. Скопируйте ссылку и отправьте системному администратору.');
}
function askEmail(original){
  const email=prompt('Email системного администратора организации:',original||'');
  if(email===null)return null;
  const value=email.trim();
  if(!value)return null;
  return value;
}
function render(organizations){
  const tbody=$('organizations');tbody.replaceChildren();
  if(!organizations.length){
    const tr=document.createElement('tr'),td=text('td','Организаций пока нет.');
    td.colSpan=5;tr.appendChild(td);tbody.appendChild(tr);return;
  }
  for(const org of organizations){
    const tr=document.createElement('tr');
    const name=document.createElement('td');name.appendChild(text('strong',org.name));
    name.appendChild(text('small',org.contactEmail||'Контактный email не указан'));
    name.appendChild(text('small','ID: '+org.id));
    tr.appendChild(name);
    tr.appendChild(text('td',org.serverMode));
    const status=document.createElement('td');
    status.appendChild(text('span',org.status, 'status '+org.status));tr.appendChild(status);
    tr.appendChild(text('td',String(org.activeMembers)+' активных / '+String(org.pendingMembers)+' ожидают'));
    const td=document.createElement('td'),actions=document.createElement('div');actions.className='actions';
    actions.appendChild(buildButton('Пригласить SysAdmin',()=>{
      const email=askEmail(org.contactEmail);
      if(email===null)return;
      perform(async()=>{
        const result=await call('POST',{action:'invite-sysadmin',organizationId:org.id,email});
        showInvitation(result.invitation?.inviteLink||'',result.invitation?.alreadyRegistered);
        await load();
      });
    }));
    if(org.status!=='ACTIVE')actions.appendChild(buildButton('Включить',()=>perform(async()=>{
      if(!confirm('Активировать доступ к организации «'+org.name+'»?'))return;
      await call('POST',{action:'set-status',organizationId:org.id,status:'ACTIVE'});
      await load();notify('Организация активирована.');
    })));
    if(org.status==='ACTIVE')actions.appendChild(buildButton('Приостановить',()=>perform(async()=>{
      if(!confirm('Приостановить ВСЕХ пользователей организации «'+org.name+'»? Данные сохранятся.'))return;
      await call('POST',{action:'set-status',organizationId:org.id,status:'SUSPENDED'});
      await load();notify('Доступ к организации приостановлен.');
    }),'danger'));
    td.appendChild(actions);tr.appendChild(td);tbody.appendChild(tr);
  }
}
async function load(){render((await call('GET')).organizations||[])}
async function init(){
  try{
    if(!await initSession())return;
    $('orgForm').addEventListener('submit',event=>{
      event.preventDefault();
      perform(async()=>{
        const f=new FormData(event.currentTarget);
        const result=await call('POST',{
          action:'create',name:String(f.get('name')||''),
          serverMode:String(f.get('serverMode')||''),
          contactEmail:String(f.get('contactEmail')||'')
        });
        $('orgForm').reset();await load();
        notify('Организация «'+result.organization.name+'» создана. Теперь пригласите SysAdmin и активируйте организацию.');
      });
    });
    $('copyInvite').onclick=async()=>{
      try{await navigator.clipboard.writeText($('inviteLink').value);notify('Ссылка приглашения скопирована.')}
      catch{$('inviteLink').focus();$('inviteLink').select();notify('Выделена ссылка — скопируйте её вручную.')}
    };
    $('closeInvite').onclick=()=>{$('inviteResult').hidden=true;$('inviteLink').value=''};
    await load();
  }catch(error){notify(error?.message||'Не удалось загрузить список организаций.',true);$('orgForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=true)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
