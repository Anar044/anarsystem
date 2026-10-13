import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEmployeeDirectory,employeeInternalCode } from '../functions/api/hr/_lib/employee-directory-xml.js';

const xml=`<employees>
  <employee><id>aaa-111</id><code>0035</code><name>Cashier</name><employee>true</employee><departmentCodes><string>A</string><string>B</string></departmentCodes><roleCodes><string>CASH</string></roleCodes></employee>
  <employee><id>bbb-222</id><code></code><firstName>Without</firstName><lastName>Code</lastName><employee>true</employee><preferredDepartmentCode>B</preferredDepartmentCode></employee>
  <employee><id>ccc-333</id><code>SYS</code><employee>false</employee></employee>
  <employee><id></id><code>BAD</code><employee>true</employee></employee>
</employees>`;

test('nested employee boolean does not truncate the XML employee record',()=>{
  const {employees,stats}=parseEmployeeDirectory(xml);
  assert.equal(stats.sourceRecords,4);
  assert.equal(stats.skippedNonEmployee,1);
  assert.equal(stats.skippedMissingId,1);
  assert.equal(employees.length,2);
  assert.equal(employees[0].code,'0035');
  assert.deepEqual(employees[0].departmentCodes,['A','B']);
  assert.deepEqual(employees[0].roleCodes,['CASH']);
});
test('employee without tab number is retained with stable internal code',()=>{
  const a=parseEmployeeDirectory(xml).employees[1];
  assert.equal(a.id,'bbb-222');
  assert.equal(a.code,'SH-ID-BBB-222');
  assert.equal(a.internalCode,true);
  assert.equal(employeeInternalCode(a.id,''),a.code);
  assert.equal(employeeInternalCode(a.id,'0040'),'0040');
});
test('plain and repeated department code XML variants are parsed',()=>{
  const {employees}=parseEmployeeDirectory('<employees><employee><id>1</id><code>5</code><departmentCodes>R1</departmentCodes><departmentCodes>R2</departmentCodes></employee></employees>');
  assert.deepEqual(employees[0].departmentCodes,['R1','R2']);
});
test('sync response identifies import, cache-only and reasons for empty scope',()=>{
  const api=readFileSync(new URL('../functions/api/hr/employees.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../hr-employees.js',import.meta.url),'utf8');
  assert.match(api,/parseEmployeeDirectory\(entry\.response\.text\)/);
  assert.match(api,/parseEmployeeDirectory\(all\.text\)/);
  assert.match(api,/reason:meta\.performed\?'SERVER_IMPORT':'MEMBER_CACHE_ONLY'/);
  assert.match(api,/sourceRecords:stats\.sourceRecords/);
  assert.match(ui,/hrSyncInfo/);
});
