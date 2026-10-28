import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../iiko-context.js', import.meta.url), 'utf8');
const first = source.indexOf('  function sameSelectedDepartments(');
const last = source.indexOf('  function setSelectedDepartmentIds(', first);
assert.ok(first > 0 && last > first, 'set comparison helper exists');
const same = runInNewContext(source.slice(first,last)+'\nsameSelectedDepartments;', {Set,String});

test('unchanged CHAIN restaurant selection ignores checkbox order', () => {
  assert.equal(same(['rms-2','rms-1'],['rms-1','rms-2']),true);
  assert.equal(same(['rms-1','rms-2'],['rms-1']),false);
  assert.equal(same(['rms-1'],['rms-2']),false);
  assert.equal(same(['rms-1','rms-1'],['rms-1']),true);
});
test('Apply bypasses reload only when authorized scope is unchanged',()=>{
  const begin=source.indexOf('    applyButton.addEventListener("click",');
  const end=source.indexOf('    listEl.addEventListener("change",',begin);
  assert.ok(begin>0 && end>begin);
  const callback=source.slice(begin,end);
  assert.match(callback,/if \(!ids\.length\) return;/);
  assert.match(callback,/sameSelectedDepartments\(ids, departmentIds\(cache\)\)/);
  assert.match(callback,/if \(unchanged\) return;/);
  assert.ok(callback.indexOf('if (unchanged) return;') < callback.indexOf('setSelectedDepartmentIds('));
  assert.ok(callback.indexOf('setSelectedDepartmentIds(') < callback.indexOf('location.reload();'));
  assert.match(callback,/silent:true,silentSelection:true/);
});
