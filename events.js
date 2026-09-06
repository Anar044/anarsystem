(function(){'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
function localDateTime(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function setDefaultDates(){const now=new Date();const start=new Date(now);start.setHours(0,0,0,0);$('events-from').value=localDateTime(start);$('events-to').value=localDateTime(now);}
function connection(){try{const raw=localStorage.getItem('iikoConnection');if(!raw)return null;const c=JSON.parse(raw);return c&&c.ip&&c.port&&c.login&&c.password?c:null;}catch{return null;}}
async function safeJson(r){const text=await r.text();if(!text)return{};try{return JSON.parse(text)}catch{return{success:false,message:text||`HTTP ${r.status}`}}}
function status(text,kind=''){const e=$('events-status');if(!e)return;e.textContent=text;e.className=`events-status ${kind}`;}
function formatDate(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'medium'});}
function userName(event){const a=event?.attributes||{};return a.userName||a.username||a.user||'—';}
function resultValue(event){const a=event?.attributes||{};const v=String(a.success??'').toLowerCase();if(v==='1'||v==='true')return'<span class="event-ok">Успешно</span>';if(v==='0'||v==='false')return'<span class="event-fail">Ошибка</span>';return'<span class="event-muted">—</span>';}
function details(event){const a=event?.attributes||{};const entries=Object.entries(a);if(!entries.length)return'<span class="event-muted">Нет атрибутов</span>';return`<details class="event-details"><summary>Показать (${entries.length})</summary><div class="event-attrs">${entries.map(([k,v])=>`<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div></details>`;}
function render(events,total){$('events-count').textContent=events.length;const body=$('events-body');body.innerHTML=events.map(e=>`<tr><td>${esc(formatDate(e.date))}</td><td><strong>${esc(e.type||'—')}</strong><small>${esc(e.id||'')}</small></td><td>${esc(userName(e))}</td><td>${esc(e.departmentId||'—')}</td><td>${resultValue(e)}</td><td>${details(e)}</td></tr>`).join('');$('events-empty').hidden=true;$('events-table-wrap').hidden=false;return total;}
function resetResult(){ $('events-count').textContent='0';$('events-period').textContent='Период не загружен';$('events-body').innerHTML='';$('events-empty').hidden=false;$('events-table-wrap').hidden=true;status('Готово к запросу'); }
async function load(){const c=connection();if(!c){status('Нет сохранённого подключения к SH Server','error');$('events-empty').innerHTML='<div class="events-empty-icon">!</div><strong>Нет подключения к SH Server</strong><span>Сначала сохраните подключение к iiko в настройках/на странице отчётов.</span>';return;}
const from=$('events-from').value,to=$('events-to').value;if(!from||!to){status('Укажите период','error');return;}if(new Date(to)<=new Date(from)){status('Проверьте период','error');return;}
const button=$('events-load');button.disabled=true;button.textContent='Загрузка…';status('Получаем события из iiko…','loading');$('events-period').textContent=`${formatDate(from)} — ${formatDate(to)}`;
try{const payload={ip:c.ip,port:c.port,login:c.login,password:c.password,from:new Date(from).toISOString(),to:new Date(to).toISOString(),type:$('events-type').value.trim(),user:$('events-user').value.trim()};const r=await fetch('/api/iiko/events',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});const data=await safeJson(r);if(!r.ok||data.success===false)throw new Error(data.message||`HTTP ${r.status}`);render(data.events||[],data.total||0);status(`Готово · найдено ${data.count||0} из ${data.total||0}`,'success');if(data.count!==data.total){$('events-period').textContent+=` · отфильтровано ${data.count} из ${data.total}`;}}
catch(e){$('events-empty').hidden=false;$('events-table-wrap').hidden=true;$('events-empty').innerHTML=`<div class="events-empty-icon">!</div><strong>Не удалось получить события</strong><span>${esc(e?.message||'Неизвестная ошибка')}</span>`;status('Ошибка запроса','error');}
finally{button.disabled=false;button.textContent='Показать события';}}
function clear(){setDefaultDates();$('events-type').value='';$('events-user').value='';resetResult();}
function init(){setDefaultDates();$('events-load').addEventListener('click',load);$('events-clear').addEventListener('click',clear);['events-from','events-to','events-type','events-user'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter')load();}));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
