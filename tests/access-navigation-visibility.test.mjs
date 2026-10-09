import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../site-access.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app-shell.css',import.meta.url),'utf8');
const shell=readFileSync(new URL('../app-shell.js',import.meta.url),'utf8');

function accessHarness(permissions){
  const rulesStart=source.indexOf('  const PAGE_RULES=');
  const navStart=source.indexOf('  function permissionFromElement(');
  const navEnd=source.indexOf('  function denyScreen(',navStart);
  assert.ok(rulesStart>=0&&navStart>rulesStart&&navEnd>navStart);
  const rules=source.slice(rulesStart,source.indexOf('  let context=',rulesStart));
  const implementation=source.slice(navStart,navEnd);
  const ctx={
    URL,location:{origin:'https://smarthoreca.pages.dev'},
    context:{allowed:true,permissions},
    canAny:list=>!list.length||list.some(code=>ctx.context.permissions.includes(code))
  };
  runInNewContext(rules+implementation+'; globalThis.navTest={permissionFromElement,applyVisibility};',ctx);
  return ctx;
}

function link(href,permission=''){
  const attrs=new Map();
  return{
    dataset:permission?{permission}:{},
    hidden:false,
    getAttribute:key=>key==='href'?href:attrs.get(key),
    matches:selector=>selector.includes('a[href]'),
    querySelectorAll:()=>[],
    closest(){return this.group||null},
    setAttribute(k,v){attrs.set(k,v)},
    removeAttribute(k){attrs.delete(k)}
  };
}
function group(links){
  const sub={querySelectorAll:()=>links,hidden:false};
  const toggle={setAttribute(){}};
  const node={
    dataset:{},hidden:false,
    classList:{remove(){}},
    querySelector:q=>q==='.documents-subnav'?sub:q==='.documents-nav-toggle'?toggle:null
  };
  for(const item of links)item.group=node;
  return node;
}
function root(links,groups=[]){
  return {
    matches:()=>false,
    querySelectorAll:selector=>selector.includes('a[href]')?links:selector.includes('documents-nav-group')?groups:[]
  };
}

test('QR Menu is absent for restaurant managers but Dashboard remains visible',()=>{
  const ctx=accessHarness(['dashboard.view','cash.view','hr.timesheet.view']);
  const qr=link('/qr-menu.html','qr.manage');
  const dashboard=link('/index.html','dashboard.view');
  ctx.navTest.applyVisibility(root([qr,dashboard]));
  assert.equal(qr.hidden,true);
  assert.equal(qr.dataset.shAccessChecked,'1');
  assert.equal(dashboard.hidden,false);
});

test('Dynamically generated HR links without data-permission use page rules',()=>{
  const ctx=accessHarness(['dashboard.view']);
  const employee=link('/hr-employees.html');
  const payroll=link('/hr-payroll-accounting.html');
  const hrGroup=group([employee,payroll]);
  ctx.navTest.applyVisibility(root([employee,payroll],[hrGroup]));
  assert.equal(employee.hidden,true);
  assert.equal(payroll.hidden,true);
  assert.equal(hrGroup.hidden,true);
  ctx.context.permissions.push('hr.employees.view');
  ctx.navTest.applyVisibility(root([employee,payroll],[hrGroup]));
  assert.equal(employee.hidden,false);
  assert.equal(payroll.hidden,true);
  assert.equal(hrGroup.hidden,false);
});

test('Procurement alternatives support either permitted scope',()=>{
  const ctx=accessHarness(['procurement.request.view_own']);
  const requests=link('/procurement.html?view=requests','procurement.request.view_own|procurement.request.view_all');
  const orders=link('/procurement.html?view=orders');
  ctx.navTest.applyVisibility(root([requests,orders]));
  assert.equal(requests.hidden,false);
  assert.equal(orders.hidden,true);
});

test('Single injected node is checked and unknown links fail closed',()=>{
  const ctx=accessHarness(['dashboard.view']);
  const dynamic=link('/hr-calendar.html');
  ctx.navTest.applyVisibility(dynamic);
  assert.equal(dynamic.hidden,true);
  const unknown=link('/restricted-new-module.html');
  ctx.navTest.applyVisibility(unknown);
  assert.equal(unknown.hidden,true);
});

test('Menu styling prevents unauthorized link flash and respects hidden',()=>{
  assert.match(css,/\.sidebar \[hidden\]\s*\{\s*display:none!important\s*\}/);
  assert.match(css,/data-sh-access-checked="1"/);
  assert.match(shell,/window\.SHAccess\?\.applyVisibility\?\.\(document\.querySelector\('\.sidebar'\)\)/);
  assert.match(source,/'qr-menu\.html':\['qr\.manage'\]/);
});
