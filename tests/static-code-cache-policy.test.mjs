import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const headers=readFileSync(new URL('../_headers',import.meta.url),'utf8');
const policies=new Map([...headers.matchAll(/^([^\s][^\r\n]*)\r?\n\s+Cache-Control:\s*([^\r\n]+)/gm)]
  .map(([,path,value])=>[path.trim(),value.trim()]));

test('static JavaScript and CSS may be revalidated instead of fully re-downloaded',()=>{
  const staticPaths=[...policies.keys()].filter(path=>/\.(?:js|css)$/.test(path));
  assert.ok(staticPaths.length>=10);
  for(const path of staticPaths){
    assert.doesNotMatch(policies.get(path),/\bno-store\b/,path+' should allow conditional revalidation');
    assert.match(policies.get(path),/\bno-cache\b/,path+' must still revalidate after a deployment');
  }
});

test('sensitive HTML and API paths remain explicitly non-cacheable',()=>{
  for(const path of ['/hr-payroll.html','/site-users.html','/rfq-response.html','/api/access/*','/api/hr/payroll']){
    assert.match(policies.get(path)||'',/\bno-store\b/,path+' must not be stored');
  }
});
