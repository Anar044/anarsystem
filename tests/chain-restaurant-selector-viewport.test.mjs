import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../iiko-context.js',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');

function menuCoordinates({vw,vh,right,bottom,open=true}) {
  const start=source.indexOf('    function placeMenu(){');
  const end=source.indexOf('    window.addEventListener("resize",placeMenu);',start);
  assert.ok(start>=0&&end>start,'standalone viewport positioner exists');
  const properties={};
  const menu={style:{setProperty:(k,v)=>properties[k]=v}};
  const wrap={classList:{contains:()=>open}};
  const button={getBoundingClientRect:()=>({right,bottom})};
  const placeMenu=new Function('button','menu','wrap','window',
    source.slice(start,end)+'\nreturn placeMenu;'
  )(button,menu,wrap,{innerWidth:vw,innerHeight:vh});
  placeMenu();
  return properties;
}

test('wide desktop panel fits below the selector; footer stays inside browser',()=>{
  const vars=menuCoordinates({vw:1650,vh:880,right:1454,bottom:194});
  assert.equal(vars['--sh-rf-top'],'202px');
  assert.equal(vars['--sh-rf-left'],'1014px');
  assert.equal(vars['--sh-rf-width'],'440px');
  assert.equal(vars['--sh-rf-height'],'666px');
  assert.ok(202+666<=880-12);
});
test('high browser zoom or short screen repositions the panel to fit',()=>{
  for(const vh of [480,560,650]){
    const vars=menuCoordinates({vw:1100,vh,right:1050,bottom:194});
    const top=parseInt(vars['--sh-rf-top'],10);
    const max=parseInt(vars['--sh-rf-height'],10);
    assert.ok(top>=12 && top+max<=vh-12);
    if(vh===480)assert.equal(top,12);
  }
});
test('narrow screens never push popup horizontally outside viewport',()=>{
  const vw=340;
  const vars=menuCoordinates({vw,vh:680,right:335,bottom:72});
  const left=parseInt(vars['--sh-rf-left'],10);
  const width=parseInt(vars['--sh-rf-width'],10);
  assert.ok(left>=12 && left+width<=vw-12);
  assert.equal(width,316);
});
test('closed popover does not recalculate position',()=>{
  assert.deepEqual(menuCoordinates({vw:1024,vh:700,right:900,bottom:194,open:false}),{});
});
test('restaurant list scrolls in a viewport-bound flex dialog while actions remain sticky',()=>{
  assert.match(source,/#sh-global-restaurant-filter \.sh-rf-menu\{position:fixed/);
  assert.match(source,/#sh-global-restaurant-filter\.open \.sh-rf-menu\{display:flex/);
  assert.match(source,/max-height:var\(--sh-rf-height,calc\(100dvh - 24px\)\)/);
  assert.match(source,/#sh-global-restaurant-filter \.sh-rf-list\{flex:1 1 180px;min-height:60px;max-height:none;overflow-y:auto/);
  assert.match(source,/#sh-global-restaurant-filter \.sh-rf-actions\{display:flex;gap:8px;flex:0 0 auto;position:sticky;bottom:0/);
  assert.match(source,/window\.addEventListener\("resize",placeMenu\)/);
  assert.match(source,/window\.visualViewport\?\.addEventListener\("resize",placeMenu\)/);
  assert.match(source,/window\.addEventListener\("scroll",placeMenu,true\)/);
  assert.match(source,/if \(open\)\{restoreApplied\(\);placeMenu\(\);loadActivity\(\);\}/);
  assert.match(dashboard,/iiko-context\.js\?v=20261028-responsive-selector/);
  assert.doesNotMatch(source,/#sh-global-restaurant-filter \.sh-rf-menu\{position:absolute/);
});
