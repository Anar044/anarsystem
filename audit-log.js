(()=>{'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let events=[],actors=[];
function iso(d){return d.toISOString().slice(0,10)}
function defaults(){const now=new Date(),from=new Date(now);from.setDate(from.getDate()-30);$('audit-from').value=iso(from);$('audit-to').value=iso(now)}
function status(t,k=''){const e=$('audit-status');e.textContent=t;e.className='audit-status '+k}
async function token(){const sb=await window.SHAuth.createClient();const{data}=await sb.auth.getSession();const t=data?.session?.access_token;if(!t)throw new Error('Сессия истекла. Войдите снова.');return t}
function actionLabel(v){return({CREATE:'Создание',UPDATE:'Изменение',DELETE:'Удаление',RESTORE:'Восстановление',PROCESS:'Проведение',UNPROCESS:'Распроведение',CREATE_AND_PROCESS:'Создание и проведение',UPDATE_AND_PROCESS:'Изменение и проведение',ASSIGN:'Назначение',SUBMIT:'Отправка',APPROVE:'Подтверждение',REJECT:'Отклонение',REOPEN:'Возврат'}[v]||v||'—')}
function entityLabel(v){return({INCOMING_INVOICE:'Приходная накладная',OUTGOING_INVOICE:'Расходная накладная',NOMENCLATURE_PRODUCT:'Номенклатура',NOMENCLATURE_GROUP:'Группа',NOMENCLATURE_CATEGORY:'Категория',PRODUCT_SCALE:'Шкала размеров',ASSEMBLY_CHART:'Техкарта',HR_EMPLOYEE_PROFILE:'Карточка сотрудника',HR_EMPLOYEE_PAY_TERM:'Условия оплаты сотрудника',HR_EMPLOYEE_LEAVE_BALANCE:'Остатки отпусков',HR_EMPLOYEE_LEAVE:'Отпуск сотрудника',HR_EMPLOYEE_SCHEDULE:'График сотрудника',HR_TIMESHEET_APPROVAL:'Подтверждение табеля',HR_TIMESHEET_CORRECTION:'Корректировка табеля',HR_OVERTIME_REQUEST:'Дополнительные часы',HR_OVERTIME_RULE:'Правило дополнительных часов',HR_LEAVE_TYPE:'Вид отпуска'}[v]||v||'Объект')}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('ru-RU')}
function displayValue(v){if(v===undefined)return'—';if(v===null)return'null';if(typeof v==='object')return JSON.stringify(v,null,2);if(v==='')return'""';return String(v)}
function semanticSame(a,b){
 if(a===b)return true;
 const ae=a===null||a===undefined||a==='',be=b===null||b===undefined||b==='';
 if(ae&&be)return true;
 const an=(typeof a==='number'||typeof a==='string')?Number(a):NaN,bn=(typeof b==='number'||typeof b==='string')?Number(b):NaN;
 if(Number.isFinite(an)&&Number.isFinite(bn)&&an===bn)return true;
 return JSON.stringify(a)===JSON.stringify(b);
}
function visibleChanges(e){
 return (Array.isArray(e?.changes)?e.changes:[]).filter(c=>{
  const field=String(c?.field||'');
  if(semanticSame(c?.oldValue,c?.newValue))return false;
  if(/\.num$/i.test(field))return false;
  if(/\.vatPercent$/i.test(field)){
    const a=c?.oldValue,b=c?.newValue;
    if((a===0&&(b===null||b===undefined||b===''))||(b===0&&(a===null||a===undefined||a==='')))return false;
  }
  return true;
 });
}
function fieldLabel(path){
 let x=String(path||'');
 x=x.replace(/items\[(\d+)\]/g,(_,n)=>'Позиция '+(Number(n)+1));
 const names={amount:'Количество',actualAmount:'Факт. количество',price:'Цена',sum:'Сумма',name:'Название',description:'Описание',documentNumber:'Номер документа',dateIncoming:'Дата',supplierId:'Поставщик',defaultStore:'Склад',defaultStoreId:'Склад',storeId:'Склад',invoice:'Счёт-фактура',incomingDocumentNumber:'Входящий №',dueDate:'Срок оплаты',comment:'Комментарий',status:'Статус',code:'Код',num:'Артикул',parent:'Группа',category:'Категория',defaultSalePrice:'Цена продажи',deleted:'Удалён',type:'Тип',mainUnit:'Единица',productId:'Товар',factualRateType:'Тип фактической ставки',factualRate:'Фактическая ставка',officialRateType:'Тип официальной ставки',officialRate:'Официальная ставка',effectiveFrom:'Действует с',effectiveTo:'Действует по',fin:'FIN',ssn:'SSN',birthDate:'Дата рождения',phonePrimary:'Основной телефон',phoneSecondary:'Доп. телефон',emailPersonal:'Личный e-mail',employmentType:'Тип занятости',workCapacityPercent:'Рабочая нагрузка',officialEmployerName:'Работодатель',officialEmployerVoen:'VÖEN',quotaCategory:'Категория / квота',entitledDays:'Начислено дней',adjustmentDays:'Корректировка дней',manualActivated:'Ручная активация',typeCode:'Вид отпуска',contour:'Контур',dateFrom:'С',dateTo:'По',days:'Дней',leaveId:'ID отпуска',scheduleId:'График',scheduleName:'Название графика'};
 return x.split('.').map(p=>names[p]||p).join(' → ');
}
function restaurant(e){const a=Array.isArray(e.restaurantNames)?e.restaurantNames.filter(Boolean):[];return a.length?a.join(', '):'—'}
function render(){
 $('audit-total').textContent=events.length;
 $('audit-change-count').textContent=events.reduce((n,e)=>n+visibleChanges(e).length,0);
 $('audit-user-count').textContent=new Set(events.map(e=>e.userId).filter(Boolean)).size;
 $('audit-row-count').textContent=events.length+' строк';
 $('audit-empty').hidden=events.length>0;
 $('audit-body').innerHTML=events.map((e,i)=>`<tr data-i="${i}"><td><b>${esc(fmtDate(e.createdAt))}</b><span class="audit-secondary">${esc(e.sourcePath||'')}</span></td><td><b>${esc(e.actorName||e.actorEmail||e.userId)}</b><span class="audit-secondary">${esc(e.actorEmail||'')}</span></td><td><span class="audit-action ${esc(e.action)}">${esc(actionLabel(e.action))}</span></td><td class="audit-object"><b>${esc(entityLabel(e.entityType))}</b><small>${esc(e.entityLabel||'')}</small></td><td><b>${esc(e.documentNumber||e.entityId||'—')}</b><span class="audit-secondary">${e.documentNumber&&e.entityId?esc(e.entityId):''}</span></td><td>${esc(restaurant(e))}</td><td class="audit-count">${visibleChanges(e).length}</td></tr>`).join('');
 $('audit-body').querySelectorAll('tr').forEach(tr=>tr.onclick=()=>openDetail(events[Number(tr.dataset.i)]));
}
function fillActors(){
 const sel=$('audit-actor'),current=sel.value;
 sel.innerHTML='<option value="">Все пользователи</option>'+actors.map(a=>`<option value="${esc(a.user_id)}">${esc(a.actor_name||a.actor_email||a.user_id)}</option>`).join('');
 if([...sel.options].some(o=>o.value===current))sel.value=current;
}
function openDetail(e){
 $('audit-detail-title').textContent=e.entityLabel||entityLabel(e.entityType);
 $('audit-detail-meta').textContent=[fmtDate(e.createdAt),e.actorName||e.actorEmail,actionLabel(e.action),e.documentNumber?'№ '+e.documentNumber:'',restaurant(e)].filter(Boolean).join(' · ');
 const changes=visibleChanges(e);
 $('audit-changes').innerHTML=changes.length?changes.map(c=>`<div class="audit-change"><div class="audit-field">${esc(fieldLabel(c.field))}</div><div class="audit-value audit-old">${esc(displayValue(c.oldValue))}</div><div class="audit-arrow">→</div><div class="audit-value audit-new">${esc(displayValue(c.newValue))}</div></div>`).join(''):'<div class="audit-nochanges">Изменений полей не зафиксировано. Для этого события записан сам факт операции.</div>';
 $('audit-overlay').hidden=false;
}
async function load(){
 const btn=$('audit-refresh');btn.disabled=true;status('Загружаем журнал…');
 try{
  const t=await token(),q=new URLSearchParams({limit:'200'});
  [['from','audit-from'],['to','audit-to'],['actor','audit-actor'],['entityType','audit-entity'],['action','audit-action'],['search','audit-search']].forEach(([k,id])=>{const v=$(id).value.trim();if(v)q.set(k,v)});
  const r=await fetch('/api/audit-log?'+q,{headers:{Authorization:'Bearer '+t,Accept:'application/json'},cache:'no-store'});
  const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false)throw new Error(d.message||('HTTP '+r.status));
  events=Array.isArray(d.events)?d.events:[];actors=Array.isArray(d.actors)?d.actors:actors;fillActors();render();status('Готово · '+d.total+' событий','ok');
 }catch(e){events=[];render();status(e.message||'Ошибка загрузки журнала','error')}finally{btn.disabled=false}
}
function bind(){
 $('audit-refresh').onclick=load;$('audit-close').onclick=()=>$('audit-overlay').hidden=true;$('audit-overlay').onclick=e=>{if(e.target===$('audit-overlay'))$('audit-overlay').hidden=true};
 ['audit-from','audit-to','audit-actor','audit-entity','audit-action'].forEach(id=>$(id).addEventListener('change',load));
 let timer;$('audit-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,350)});
}
async function init(){defaults();bind();await load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();