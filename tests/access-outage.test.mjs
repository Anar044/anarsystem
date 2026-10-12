import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../site-access.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../functions/api/access/me.js',import.meta.url),'utf8');

async function simulate(status,payload){
  const created=[];
  const action={textContent:'',onclick:null};
  let reloadCount=0;
  const document={
    documentElement:{style:{}},
    body:{innerHTML:'',appendChild(){}},
    head:{appendChild(){}},
    getElementById(){return null},
    createElement(){
      const el={id:'',innerHTML:'',querySelector:()=>action};
      created.push(el);return el;
    },
    addEventListener(){},dispatchEvent(){}
  };
  const window={SHAuth:{createClient:async()=>({
    auth:{getSession:async()=>({data:{session:{access_token:'sample-session'}}})}
  })}};
  const context={
    window,document,
    location:{search:'',pathname:'/dashboard',reload(){reloadCount++}},
    localStorage:{removeItem(){}},
    URL,URLSearchParams,console,
    fetch:async()=>({status,ok:status>=200&&status<300,json:async()=>payload}),
    MutationObserver:class{observe(){}},
    CustomEvent:class{},Event:class{}
  };
  runInNewContext(source,context);
  const result=await window.SHAccess.load();
  const card=created.find(el=>el.id==='sh-access-denied');
  return{result,card,action,reloadCount:()=>reloadCount};
}

test('503 is shown as temporary service issue, never a revoked user permission',async()=>{
  const h=await simulate(503,{});
  assert.equal(h.result.reason,'ACCESS_SERVICE_UNAVAILABLE');
  assert.match(h.card.innerHTML,/<h1>Сервис временно недоступен<\/h1>/);
  assert.doesNotMatch(h.card.innerHTML,/<h1>Нет доступа<\/h1>/);
  assert.equal(h.action.textContent,'Повторить');
  h.action.onclick();
  assert.equal(h.reloadCount(),1);
});
test('403 NO_MEMBERSHIP stays an explicit access denial',async()=>{
  const h=await simulate(403,{success:true,access:{allowed:false,reason:'NO_MEMBERSHIP'}});
  assert.equal(h.result.reason,'NO_MEMBERSHIP');
  assert.match(h.card.innerHTML,/<h1>Нет доступа<\/h1>/);
  assert.match(h.card.innerHTML,/NO_MEMBERSHIP/);
  assert.notEqual(h.action.textContent,'Повторить');
});
test('malformed successful API response is not a permission revocation',async()=>{
  const h=await simulate(200,{success:true});
  assert.equal(h.result.reason,'ACCESS_SERVICE_UNAVAILABLE');
  assert.equal(h.action.textContent,'Повторить');
});
test('server error response provides a stable reason without exposing exception text',()=>{
  assert.match(server,/reason:'ACCESS_CHECK_FAILED'/);
  assert.doesNotMatch(server,/message:error\?\.message\|\|String\(error\)/);
});
