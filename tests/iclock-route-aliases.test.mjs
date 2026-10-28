import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('ZKTeco .aspx routes preserve GET and POST through the original handler',()=>{
  for(const name of ['cdata','devicecmd','getrequest','ping','push','querydata','registry']){
    const primary=source('functions/iclock/'+name+'.js');
    const alias=source('functions/iclock/'+name+'.aspx.js');
    assert.match(primary,/export async function onRequestGet/);
    assert.match(primary,/export async function onRequestPost/);
    assert.equal(alias.trim(),'export { onRequestGet, onRequestPost } from "./'+name+'.js";');
  }
});
