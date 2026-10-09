import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../site-users.js',import.meta.url),'utf8');
const start=source.indexOf('function memberModal(member=null){');
const end=source.indexOf('function invitationModal(result,email){',start);
assert.ok(start>=0&&end>start,'User form function must be present');
const formFunction=source.slice(start,end);
const restaurants=[
  {id:'dept-1',code:'1',name:'RMS 1'},
  {id:'dept-2',code:'2',name:'RMS 2'}
];

function makeHarness(member=null){
  const saved=[],fields={},calls=[],modal=[];
  function field(id){
    return fields[id]??=(id==='memberEmployee'
      ?{value:'',selectedOptions:[{dataset:{name:''}}]}
      :{value:''});
  }
  const context={
    data:{roles:[{id:'role-manager',name:'Менеджер ресторана',description:'Менеджер своего RMS'}]},
    employees:[],
    departmentOptions:()=>restaurants,
    esc:x=>String(x??'').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    openModal:html=>modal.push(html),
    $:field,
    document:{querySelectorAll:selector=>selector==='[data-department-id]:checked'
      ?[{dataset:{departmentId:'dept-1'}}]
      :selector==='[data-role]:checked'?[{dataset:{role:'role-manager'}}]:[]},
    api:async(method,body)=>{calls.push({method,body});return{}},
    closeModal:()=>{},
    load:async()=>{},
    status:()=>{},
    invitationModal:()=>{}
  };
  runInNewContext(formFunction+';globalThis.testMemberModal=memberModal;',context);
  context.testMemberModal(member);
  return{fields:field,html:modal[0],calls,saved};
}
test('Access modal shows an independent Smart Horeca name field without staff link',()=>{
  const t=makeHarness();
  assert.match(t.html,/Имя в Smart Horeca/);
  assert.match(t.html,/id="memberDisplayName"/);
  assert.match(t.html,/Не связывать/);
  assert.match(t.html,/Подразделения CHAIN/);
});
test('An invited manager can be named without HR employee binding',async()=>{
  const t=makeHarness();
  t.fields('memberDisplayName').value='Менеджер ресторана RMS 1';
  t.fields('memberEmail').value='rms1.manager@example.test';
  t.fields('memberScope').value='SELECTED';
  t.fields('memberEmployee').value='';
  await t.fields('saveMember').onclick();
  assert.equal(t.calls.length,1);
  const sent=t.calls[0].body.member;
  assert.equal(sent.employeeId,'');
  assert.equal(sent.displayName,'Менеджер ресторана RMS 1');
  assert.equal(sent.email,'rms1.manager@example.test');
  assert.deepEqual(Array.from(sent.scope.departmentIds),['dept-1']);
  assert.deepEqual(Array.from(sent.scope.departmentCodes),['1']);
  assert.deepEqual(Array.from(sent.roleIds),['role-manager']);
});
test('Editing existing invited user retains editable custom site name',async()=>{
  const member={id:'existing-id',email:'old.manager@example.test',displayName:'Старший менеджер RMS 2',
    employeeId:'',roleIds:[],scope:{mode:'ALL',departmentIds:[],departmentCodes:[]}};
  const t=makeHarness(member);
  assert.match(t.html,/value="Старший менеджер RMS 2"/);
  t.fields('memberDisplayName').value='Управляющий сети';
  t.fields('memberEmail').value=member.email;
  t.fields('memberScope').value='ALL';
  await t.fields('saveMember').onclick();
  assert.equal(t.calls[0].body.member.displayName,'Управляющий сети');
  assert.equal(t.calls[0].body.member.id,'existing-id');
});
test('Selecting an HR employee suggests name, but never overwrites typed user name',()=>{
  const t=makeHarness();
  t.fields('memberEmployee').selectedOptions=[{dataset:{name:'Ali Mammadov'}}];
  t.fields('memberEmployee').onchange();
  assert.equal(t.fields('memberDisplayName').value,'Ali Mammadov');
  t.fields('memberDisplayName').value='Директор RMS 1';
  t.fields('memberEmployee').selectedOptions=[{dataset:{name:'Elsewhere Employee'}}];
  t.fields('memberEmployee').onchange();
  assert.equal(t.fields('memberDisplayName').value,'Директор RMS 1');
});
test('Manual name is mandatory for new unlinked user',async()=>{
  const t=makeHarness();
  t.fields('memberEmail').value='user@example.test';
  t.fields('memberScope').value='ALL';
  const previous=globalThis.alert;
  globalThis.alert=message=>{assert.match(message,/Укажите имя пользователя/)};
  // Inject a spy into the VM function's lexical context rather than using UI alert.
  // The browser handler intentionally catches validation errors.
  try{await t.fields('saveMember').onclick()}finally{globalThis.alert=previous}
  assert.equal(t.calls.length,0);
});
