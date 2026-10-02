(()=>{
'use strict';
const $=id=>document.getElementById(id);
let conversations=[],currentId='',busy=false,currentMessages=[];
let mediaRecorder=null,mediaStream=null,audioChunks=[],recordStarted=0,recordTicker=null,recordStopTimer=null,currentAudio=null,currentAudioUrl='';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw Error('Supabase Auth не готов');const r=await c.auth.getSession();const t=r.data?.session?.access_token;if(r.error||!t)throw Error('Сессия пользователя не найдена');return t}
async function get(q){const t=await token(),r=await fetch('/api/ai-assistant'+q,{headers:{Authorization:'Bearer '+t},cache:'no-store'}),j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));return j}
async function post(body){const t=await token(),r=await fetch('/api/ai-assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));if(!r.ok||!j.success){const e=Error(j.message||('HTTP '+r.status));e.code=j.code||'';throw e}return j}
function fmt(v){try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return''}}

function reportCard(report){
  if(!report||typeof report!=='object')return'';
  const columns=Array.isArray(report.columns)?report.columns:[];
  const rows=Array.isArray(report.rows)?report.rows:[];
  const totals=Array.isArray(report.totals)?report.totals:[];
  const kpis=Array.isArray(report.kpis)?report.kpis:[];
  const notes=Array.isArray(report.notes)?report.notes:[];
  const align=(value)=>['left','right','center'].includes(value)?value:'left';
  const table=columns.length
    ? '<div class="sha-report-table-wrap"><table class="sha-report-table"><thead><tr>'+
      columns.map(col=>'<th class="is-'+align(col?.align)+'">'+esc(col?.label||'')+'</th>').join('')+
      '</tr></thead><tbody>'+
      rows.map(row=>'<tr>'+columns.map((col,i)=>'<td class="is-'+align(col?.align)+'">'+esc(Array.isArray(row)?(row[i]??''):'')+'</td>').join('')+'</tr>').join('')+
      '</tbody>'+
      (totals.length?'<tfoot><tr>'+columns.map((col,i)=>'<td class="is-'+align(col?.align)+'">'+esc(totals[i]??'')+'</td>').join('')+'</tr></tfoot>':'')+
      '</table></div>'
    :'';
  return '<section class="sha-report">'+
    '<div class="sha-report-head"><div><span class="sha-report-eyebrow">SMART HORECA REPORT</span><h3>'+esc(report.title||'Отчёт')+'</h3>'+
    (report.subtitle?'<p>'+esc(report.subtitle)+'</p>':'')+'</div>'+
    (report.periodLabel?'<span class="sha-report-period">'+esc(report.periodLabel)+'</span>':'')+
    '</div>'+
    (kpis.length?'<div class="sha-report-kpis">'+kpis.map(item=>'<div class="sha-report-kpi"><span>'+esc(item?.label||'')+'</span><strong>'+esc(item?.value||'')+'</strong></div>').join('')+'</div>':'')+
    table+
    (notes.length?'<div class="sha-report-notes">'+notes.map(note=>'<div>'+esc(note)+'</div>').join('')+'</div>':'')+
    '</section>';
}

function tools(meta){const map={list_smart_horeca_capabilities:'Источники SmartHoreca',search_products:'Номенклатура',analyze_purchase_prices:'Приходные накладные',get_supplier_balances:'Баланс по поставщикам',search_olap_fields:'Поля OLAP',run_olap_report:'OLAP отчёт'};const a=Array.isArray(meta?.tools)?meta.tools:[];return a.length?'<div class="sha-tools-used">'+a.map(x=>'<span class="sha-tool-chip">'+esc(map[x.name]||x.name)+(x.error?' · ошибка':'')+'</span>').join('')+'</div>':''}
function msg(m,index=-1){
  const ai=m.role==='assistant';
  const speak=ai&&index>=0?'<button class="sha-speak" type="button" data-speak-index="'+index+'" title="Озвучить ответ">🔊 Озвучить</button>':'';
  const structured=ai&&m.meta?.report?reportCard(m.meta.report):'';
  const text=esc(m.content).replace(/\n/g,'<br>');
  return '<article class="sha-message '+(ai?'assistant':'user')+'"><div class="sha-avatar">'+(ai?'AI':'Вы')+'</div><div class="sha-bubble '+(structured?'has-report':'')+'">'+
    (text?'<div class="sha-text">'+text+'</div>':'')+
    structured+
    (ai?tools(m.meta):'')+speak+
    '</div></article>';
}
function renderMessages(a){currentMessages=Array.isArray(a)?a:[];$('welcome').hidden=currentMessages.length>0;$('messages').innerHTML=currentMessages.map((m,i)=>msg(m,i)).join('');requestAnimationFrame(()=>{$('messages').scrollTop=$('messages').scrollHeight})}
function renderChats(){$('conversationEmpty').hidden=conversations.length>0;$('conversationList').innerHTML=conversations.map(x=>'<button class="sha-conversation '+(x.id===currentId?'active':'')+'" data-id="'+esc(x.id)+'"><strong>'+esc(x.title||'Новый чат')+'</strong><span>'+esc(fmt(x.updated_at))+'</span></button>').join('');$('conversationList').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>select(b.dataset.id))}
function state(t,k){$('assistantState').textContent=t;$('assistantState').className='sha-state '+(k||'')}
function note(t,k){$('composerStatus').textContent=t||'';$('composerStatus').className='sha-composer-status '+(k||'')}
function size(){const i=$('messageInput');i.style.height='auto';i.style.height=Math.min(160,Math.max(36,i.scrollHeight))+'px'}
async function loadStatus(){const j=await get('?action=status');if(!j.configured){state('OpenAI не настроен','warn');note('Добавьте OPENAI_API_KEY в Cloudflare Preview.','error');return}state(j.model+' · '+(j.iikoConnected?'iiko подключён':'iiko не подключён'),j.iikoConnected?'ok':'warn')}
async function loadChats(){const j=await get('?action=conversations');conversations=j.conversations||[];renderChats()}
async function select(id){currentId=id;renderChats();const j=await get('?action=messages&conversationId='+encodeURIComponent(id));$('chatTitle').textContent=j.conversation?.title||'AI Ассистент SmartHoreca';$('deleteChatBtn').hidden=false;renderMessages(j.messages||[])}
async function newChat(){const j=await post({action:'newConversation',title:'Новый чат'});currentId=j.conversation.id;await loadChats();$('chatTitle').textContent='Новый чат';$('deleteChatBtn').hidden=false;renderMessages([]);$('messageInput').focus()}
function thinking(){const n=document.createElement('article');n.id='shaThinking';n.className='sha-message assistant';n.innerHTML='<div class="sha-avatar">AI</div><div class="sha-bubble"><span class="sha-thinking"><i></i><i></i><i></i></span> Анализирую данные SmartHoreca…</div>';$('messages').appendChild(n);$('welcome').hidden=true;$('messages').scrollTop=$('messages').scrollHeight}
function voiceMimeType(){
  const options=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];
  return options.find(type=>window.MediaRecorder?.isTypeSupported?.(type))||'';
}
function voiceExtension(type){if(type.includes('mp4'))return'm4a';if(type.includes('ogg'))return'ogg';return'webm'}
function setRecordingUi(active){
  const button=$('micBtn'),timer=$('recordTimer');
  button.classList.toggle('recording',active);
  button.setAttribute('aria-pressed',active?'true':'false');
  button.title=active?'Остановить запись':'Голосовой запрос';
  timer.hidden=!active;
  if(!active)timer.textContent='0:00';
}
function cleanupRecording(){
  if(recordTicker){clearInterval(recordTicker);recordTicker=null}
  if(recordStopTimer){clearTimeout(recordStopTimer);recordStopTimer=null}
  if(mediaStream){mediaStream.getTracks().forEach(track=>track.stop());mediaStream=null}
  mediaRecorder=null;
  setRecordingUi(false);
}
function updateRecordTimer(){
  const elapsed=Math.max(0,Math.floor((Date.now()-recordStarted)/1000));
  $('recordTimer').textContent=Math.floor(elapsed/60)+':'+String(elapsed%60).padStart(2,'0');
}
async function transcribeVoice(blob,mimeType){
  const t=await token(),form=new FormData();
  form.set('audio',blob,'voice.'+voiceExtension(mimeType||blob.type||''));
  const r=await fetch('/api/ai-assistant-transcribe',{method:'POST',headers:{Authorization:'Bearer '+t},body:form});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
  return j.text;
}
async function speakText(text,button=null){
  const value=String(text||'').trim();
  if(!value)return;
  if(currentAudio){currentAudio.pause();currentAudio=null}
  if(currentAudioUrl){URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=''}
  if(button)button.classList.add('playing');
  note('Озвучиваю ответ…');
  try{
    const t=await token();
    const r=await fetch('/api/ai-assistant-speech',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({text:value})});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.message||('HTTP '+r.status))}
    const blob=await r.blob();
    currentAudioUrl=URL.createObjectURL(blob);
    currentAudio=new Audio(currentAudioUrl);
    currentAudio.onended=()=>{if(button)button.classList.remove('playing');note('')};
    currentAudio.onerror=()=>{if(button)button.classList.remove('playing');note('Не удалось воспроизвести голосовой ответ.','error')};
    await currentAudio.play();
  }catch(e){
    if(button)button.classList.remove('playing');
    note(e.message||String(e),'error');
  }
}
async function finishVoiceRecording(blob,mimeType){
  if(!blob||blob.size<800){note('Запись слишком короткая. Попробуйте ещё раз.','error');return}
  note('Распознаю голос…');
  try{
    const text=await transcribeVoice(blob,mimeType);
    $('messageInput').value=text;
    size();
    note('Распознано: «'+text+'»');
    await send({speakReply:true});
  }catch(e){note(e.message||String(e),'error')}
}
async function startVoice(){
  if(busy)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Браузер не поддерживает запись с микрофона.');
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const mimeType=voiceMimeType();
  mediaRecorder=mimeType?new MediaRecorder(mediaStream,{mimeType}):new MediaRecorder(mediaStream);
  audioChunks=[];
  mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data)};
  mediaRecorder.onerror=e=>{note(e.error?.message||'Ошибка записи микрофона.','error');cleanupRecording()};
  mediaRecorder.onstop=()=>{
    const type=mediaRecorder?.mimeType||mimeType||'audio/webm';
    const blob=new Blob(audioChunks,{type});
    cleanupRecording();
    finishVoiceRecording(blob,type);
  };
  mediaRecorder.start(250);
  recordStarted=Date.now();
  setRecordingUi(true);
  updateRecordTimer();
  recordTicker=setInterval(updateRecordTimer,500);
  recordStopTimer=setTimeout(()=>{if(mediaRecorder?.state==='recording')mediaRecorder.stop()},120000);
  note('Слушаю… Нажмите микрофон ещё раз, когда закончите.');
}
function stopVoice(){if(mediaRecorder?.state==='recording')mediaRecorder.stop()}
async function toggleVoice(){
  if(mediaRecorder?.state==='recording'){stopVoice();return}
  try{await startVoice()}catch(e){cleanupRecording();note(e.message||String(e),'error')}
}
async function send(options={}){if(busy)return;const i=$('messageInput'),text=i.value.trim();if(!text)return;busy=true;$('sendBtn').disabled=true;$('micBtn').disabled=true;note('Получаю данные и собираю ответ…');i.value='';size();$('welcome').hidden=true;$('messages').insertAdjacentHTML('beforeend',msg({role:'user',content:text}));thinking();try{const j=await post({action:'message',conversationId:currentId||null,message:text});currentId=j.conversationId;await loadChats();await select(currentId);note('');if(options?.speakReply&&j.answer)await speakText(j.answer)}catch(e){document.getElementById('shaThinking')?.remove();note(e.message,'error');if(e.code==='OPENAI_NOT_CONFIGURED')state('OpenAI не настроен','warn')}finally{busy=false;$('sendBtn').disabled=false;$('micBtn').disabled=false;i.focus()}}
async function del(){if(!currentId||!confirm('Удалить этот AI-диалог?'))return;await post({action:'deleteConversation',conversationId:currentId});currentId='';$('deleteChatBtn').hidden=true;$('chatTitle').textContent='AI Ассистент SmartHoreca';renderMessages([]);await loadChats()}
function bind(){$('newChatBtn').onclick=()=>newChat().catch(e=>note(e.message,'error'));$('deleteChatBtn').onclick=()=>del().catch(e=>note(e.message,'error'));$('sendBtn').onclick=()=>send();$('micBtn').onclick=toggleVoice;$('messageInput').oninput=size;$('messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};$('messages').addEventListener('click',e=>{const button=e.target.closest?.('[data-speak-index]');if(!button)return;const index=Number(button.dataset.speakIndex);const message=currentMessages[index];if(message?.role==='assistant')speakText(message.content,button)});document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{$('messageInput').value=b.dataset.example||b.textContent;size();send()})}
async function init(){bind();try{await Promise.all([loadStatus(),loadChats()]);if(conversations[0])await select(conversations[0].id)}catch(e){state('Ошибка','error');note(e.message,'error')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();