import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeDepartmentsPayload,parseDepartmentsXml,safeDepartmentDiagnostic} from '../functions/api/iiko/_lib/departments.js';

const UUID='b5909f4b-bff1-4b80-bb42-0932e23e12cf';
test('CHAIN JSON with corporateItemDtoes wrapper resolves genuine departments',()=>{
  const json={corporateItemDtoes:{corporateItemDto:[
    {id:'corp',name:'Company',type:'CORPORATION'},
    {id:UUID,parentId:'corp',name:'Restaurant RMS 1',code:'RMS1',type:'DEPARTMENT'},
    {id:'store',name:'Central store',type:'STORE'}]}};
  assert.deepEqual(normalizeDepartmentsPayload(json),[
    {id:UUID,parentId:'corp',name:'Restaurant RMS 1',code:'RMS1',type:'DEPARTMENT'}
  ]);
  assert.equal(safeDepartmentDiagnostic(json).candidates,3);
});
test('arrays, nested data wrapper and case variants',()=>{
  const json={data:{items:[{Id:UUID,Name:'RMS 2',Type:'DEPARTMENT'},
    {id:'store-id',name:'Warehouse',type:'CENTRALSTORE'},
    {id:UUID,name:'RMS 2 duplicate',type:'DEPARTMENT'}]}};
  assert.equal(normalizeDepartmentsPayload(json).length,1);
  assert.equal(normalizeDepartmentsPayload([{id:UUID,name:'RMS 1',type:'DEPARTMENT'}]).length,1);
});
test('classic corporateItemDtoes XML',()=>{
  const xml='<?xml version="1.0"?><corporateItemDtoes><corporateItemDto>'+
    '<id>'+UUID+'</id><parentId>corp</parentId><code>RMS1</code>'+
    '<name>Restaurant &amp; Cafe</name><type>DEPARTMENT</type>'+
    '</corporateItemDto></corporateItemDtoes>';
  assert.deepEqual(parseDepartmentsXml(xml),[
    {id:UUID,parentId:'corp',code:'RMS1',name:'Restaurant & Cafe',type:'DEPARTMENT'}
  ]);
  assert.equal(safeDepartmentDiagnostic(xml,'xml').candidates,1);
});
test('namespaced CHAIN XML parses without fake corporate or store departments',()=>{
  const xml='<ns:corporateItemDtoes xmlns:ns="x">'+
    '<ns:corporateItemDto><ns:id>corp</ns:id><ns:name>Holding</ns:name><ns:type>CORPORATION</ns:type></ns:corporateItemDto>'+
    '<ns:corporateItemDto><ns:id>'+UUID+'</ns:id><ns:name>RMS 3</ns:name><ns:type>DEPARTMENT</ns:type></ns:corporateItemDto>'+
    '<ns:corporateItemDto><ns:id>store</ns:id><ns:name>Central Store</ns:name><ns:type>STORE</ns:type></ns:corporateItemDto>'+
    '</ns:corporateItemDtoes>';
  assert.deepEqual(parseDepartmentsXml(xml),[
    {id:UUID,parentId:null,code:'',name:'RMS 3',type:'DEPARTMENT'}
  ]);
  assert.equal(safeDepartmentDiagnostic(xml,'xml').candidates,3);
});
test('absent departments remain empty; nothing synthesized from corporate name',()=>{
  const json={corporateItemDtoes:[{id:'holding',name:'Chain',type:'CORPORATION'},
    {id:'office',name:'Office',type:'CENTRALOFFICE'}]};
  assert.equal(normalizeDepartmentsPayload(json).length,0);
  assert.equal(parseDepartmentsXml('<corporateItemDto><id>office</id><type>CENTRALOFFICE</type></corporateItemDto>').length,0);
});
test('platform connection failures disclose only safe diagnostic metadata',()=>{
  const server=readFileSync(new URL('../functions/api/platform/server.js',import.meta.url),'utf8');
  assert.match(server,/classic\.diagnostic/);
  assert.match(server,/DEPARTMENTS_EMPTY/);
  assert.doesNotMatch(server.slice(server.indexOf('async function discover('),server.indexOf('export async function onRequestOptions')),/rawPreview|password|login|auth\.token/);
});
