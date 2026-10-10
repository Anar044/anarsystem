import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const src=readFileSync(new URL('../mobile-responsive.js',import.meta.url),'utf8');
function helpers(){
  const first=src.indexOf('const MAX_QUICK=4;');
  const last=src.indexOf('function shortLabel(',first);
  assert.ok(first>=0&&last>first,'Could not find mobile navigation helpers');
  return src.slice(first,last);
}
function makeLink(href,label,{checked=true,hidden=false,section='Основное'}={}){
  return{
    dataset:{shAccessChecked:checked?'1':''},
    hidden,
    getAttribute:name=>name==='href'?href:null,
    closest:()=>section==='Основное'?null:{
      querySelector:()=>({textContent:section})
    },
    querySelector:()=>({textContent:label}),
    textContent:label
  };
}
function setup(links,pathname='/index.html',search=''){
  const menu={querySelectorAll:()=>links};
  const ctx={
    URL,URLSearchParams,
    location:{origin:'https://smarthoreca.pages.dev',pathname,search},
    document:{querySelector:()=>menu},
    window:{SHAccess:{applyVisibility:()=>{}}},
  };
  runInNewContext(helpers()+';globalThis.subject={collectAllowedLinks,selectQuickLinks,isCurrent};',ctx);
  return ctx.subject;
}
test('Manager lower navigation excludes forbidden QR, finance and settings',()=>{
  const permitted=[
    makeLink('/index.html','Dashboard'),
    makeLink('/reports.html','OLAP',{section:'Отчёты'}),
    makeLink('/cash','Кассы'),
    makeLink('/hr-employees.html','Сотрудники',{section:'Сотрудники'}),
    makeLink('/hr-timesheet.html','Табель',{section:'Сотрудники'})
  ];
  const forbidden=[
    makeLink('/qr-menu.html','QR Menu',{hidden:true}),
    makeLink('/finance.html','Финансы',{hidden:true}),
    makeLink('/settings.html','Настройки',{hidden:true})
  ];
  const {collectAllowedLinks,selectQuickLinks}=setup([...permitted,...forbidden]);
  const items=collectAllowedLinks(),{quick,other}=selectQuickLinks(items);
  assert.equal(items.length,5);
  assert.deepEqual([...quick.map(x=>x.page)],['index.html','reports.html','cash.html','hr-employees.html']);
  assert.deepEqual([...other.map(x=>x.page)],['hr-timesheet.html']);
  assert.equal([...quick,...other].some(x=>x.page==='qr-menu.html'),false);
});
test('Unchecked links never show before access verification',()=>{
  const links=[
    makeLink('/index.html','Dashboard'),
    makeLink('/qr-menu.html','QR Menu',{checked:false}),
    makeLink('/site-users.html','Users',{hidden:true})
  ];
  assert.deepEqual([...setup(links).collectAllowedLinks().map(x=>x.page)],['index.html']);
});
test('Owner can reach all allowed sections with overflow navigation',()=>{
  const links=[
    makeLink('/index.html','Dashboard'),
    makeLink('/reports.html','OLAP',{section:'Отчёты'}),
    makeLink('/cash','Кассы'),
    makeLink('/hr-employees.html','Сотрудники',{section:'Сотрудники'}),
    makeLink('/finance.html','Финансы'),
    makeLink('/qr-menu.html','QR Menu'),
    makeLink('/settings.html','Настройки')
  ];
  const {collectAllowedLinks,selectQuickLinks}=setup(links);
  const {quick,other}=selectQuickLinks(collectAllowedLinks());
  assert.equal(quick.length,4);
  assert.equal(other.length,2);
  assert.ok(other.some(x=>x.page==='qr-menu.html'));
  assert.equal([...quick,...other].some(x=>x.page==='settings.html'),false);
});
test('Mobile shortcuts highlight cash route aliases and procurement specific views',()=>{
  const cash=setup([], '/cash/index.html');
  assert.equal(cash.isCurrent({page:'cash.html',href:'/cash'}),true);
  const procurement=setup([], '/procurement.html','?view=receiving');
  assert.equal(procurement.isCurrent({page:'procurement.html',href:'/procurement.html?view=orders'}),false);
  assert.equal(procurement.isCurrent({page:'procurement.html',href:'/procurement.html?view=receiving'}),true);
});
test('Navigation is loaded only for authorized sessions and has accessible overflow',()=>{
  assert.match(src,/window\.SHAccess\?\.context\?\.allowed/);
  assert.match(src,/document\.addEventListener\('sh-access-ready'/);
  assert.match(src,/data-sh-access-checked|shAccessChecked/);
  assert.match(src,/aria-expanded/);
  assert.match(src,/role','dialog'/);
  assert.doesNotMatch(src,/const items=\[\s*\['\/index\.html'/);
});
