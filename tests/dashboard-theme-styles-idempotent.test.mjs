import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../dashboard-theme-loader.js',import.meta.url),'utf8');
const start=script.indexOf('  function addStyles(){');
const stop=script.indexOf('\n  function sync(){',start);
assert.ok(start>=0&&stop>start,'Dashboard style setup is available');

function runner(){
  const items=new Map();
  const counters={cssWrites:0,hrefWrites:0};
  const createElement=tag=>{
    let css='',url='';
    const element={tagName:tag,dataset:{},id:''};
    Object.defineProperty(element,'textContent',{
      get(){return css},set(value){if(tag==='style')counters.cssWrites++;css=value}
    });
    Object.defineProperty(element,'href',{
      get(){return url},set(value){counters.hrefWrites++;url=value}
    });
    return element;
  };
  const document={
    createElement,
    getElementById:id=>items.get(id)||null,
    head:{appendChild(element){items.set(element.id,element)}}
  };
  const addStyles=runInNewContext(script.slice(start,stop)+'\naddStyles;', {document});
  return {addStyles,items,counters};
}

test('Dashboard injects theme CSS exactly once even when sync() repeats',()=>{
  const ctx=runner();
  ctx.addStyles();
  const css=ctx.items.get('dashboard-sketch-style').textContent;
  assert.ok(css.length>10000);
  assert.match(css,/html\[data-theme="light"\]/);
  assert.match(css,/html\[data-theme="dark"\]/);
  assert.equal(ctx.counters.cssWrites,1);
  assert.equal(ctx.counters.hrefWrites,2);
  ctx.addStyles();ctx.addStyles();ctx.addStyles();
  assert.equal(ctx.counters.cssWrites,1,'repeat sync must not trigger stylesheet parse');
  assert.equal(ctx.counters.hrefWrites,2,'repeat sync must not reset link URLs');
});
test('if the CSS node is removed, the next sync safely restores it',()=>{
  const ctx=runner();
  ctx.addStyles();
  ctx.items.delete('dashboard-sketch-style');
  ctx.addStyles();
  assert.equal(ctx.counters.cssWrites,2);
  assert.equal(ctx.items.get('dashboard-sketch-style').dataset.shCssReady,'1');
});
