import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { namedScopedWarehouses, matchStoresForDepartments } from '../functions/api/iiko/_lib/store-scope.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const references = read('functions/api/iiko/invoice-reference-data.js');
const matching = read('functions/api/ai-documents.js');
const page = read('ai-documents.js');
const html = read('ai-documents.html');

const selected = {
  selectedDepartmentIds: ['rms-a'],
  storeIds: ['{STORE-A}', 'STORE-B'],
  resolved: true,
  stores: [
    {id:'store-a', name:'Основной склад', parentId:'rms-a'},
    {id:'store-b', name:'Бар', parentId:'rms-a'}
  ]
};

test('Named stores from selected CHAIN hierarchy appear when cached warehouse catalog is empty', () => {
  const names = namedScopedWarehouses(selected, new Map());
  assert.deepEqual([...names], [['store-a','Основной склад'],['store-b','Бар']]);
});
test('Incomplete warehouse catalog is completed from verified CHAIN hierarchy without guessing', () => {
  const names = namedScopedWarehouses(selected, new Map([['store-a','Актуальное название']]));
  assert.deepEqual([...names], [['store-a','Актуальное название'],['store-b','Бар']]);
});
test('Stores outside selected restaurant never appear even when they exist in cache', () => {
  const names = namedScopedWarehouses(selected,new Map([
    ['STORE-C','Чужой склад'],['{STORE-A}','Основной склад'],['store-b','Бар']
  ]));
  assert.equal(names.size,2);
  assert.equal(names.has('store-c'),false);
  assert.deepEqual([...names.keys()],['store-a','store-b']);
});
test('Never show arbitrary warehouse ID as the warehouse name when neither source knows it', () => {
  assert.equal(namedScopedWarehouses({storeIds:['unknown'],stores:[{id:'unknown',name:''}]}, new Map()).size,0);
  assert.equal(namedScopedWarehouses({storeIds:[],stores:selected.stores},new Map([['store-a','store']])).size,0);
});
test('Hierarchy store relationships resolve only the selected restaurant', () => {
  const stores = { stores: [
    {id:'store-a',name:'Основной склад',parentId:'rms-a'},
    {id:'store-other',name:'Чужой склад',parentId:'rms-b'}
  ], nodes: [
    {id:'rms-a',parentId:'chain-root'},
    {id:'rms-b',parentId:'chain-root'}
  ] };
  const result = matchStoresForDepartments(stores,{nodes:[],stores:[]},['rms-a']);
  assert.deepEqual(result.matched.map(x=>x.id),['store-a']);
  const named = namedScopedWarehouses({storeIds:result.matched.map(x=>x.id),stores:result.matched},new Map());
  assert.deepEqual([...named.values()],['Основной склад']);
});
test('Invoice reference API refills verified warehouse names after fallback and rejects empty selectors', () => {
  assert.match(references,/namedScopedWarehouses\(storeScope,warehouseMap\)/);
  assert.match(references,/code:"INVOICE_WAREHOUSE_NAMES_UNAVAILABLE"/);
  assert.match(references,/departmentScopeApplied: subsetRequested/);
  assert.match(references,/INVOICE_REFERENCE_SCOPE_UNAVAILABLE/);
  assert.match(references,/loadRequestIikoState\(request,env\)/);
  assert.match(references,/resolveRestaurantScope\(\{state:accessState,request,requestedIds,strict:true\}\)/);
  assert.match(references,/departmentIds\.length===1\|\|allowedIds\.length>departmentIds\.length/);
});
test('AI matching does not require a populated generic warehouse cache if CHAIN knows warehouses', () => {
  assert.match(matching,/requiredKeys:\["suppliers","products"\]/);
  assert.match(matching,/namedScopedWarehouses\(storeScope/);
  assert.match(matching,/AI_DOCUMENT_WAREHOUSES_UNAVAILABLE/);
  assert.match(matching,/storeSelectionRequired:true/);
});
test('AI Document form surfaces missing warehouses instead of silently caching an empty dropdown', () => {
  assert.match(page,/if\(!warehouses\.length\)throw new Error/);
  assert.match(page,/Склады не загружены/);
  assert.match(page,/else if\(refsWarning\).*else if\(m\.ready\)/);
  assert.match(html,/ai-documents\.js\?v=20261029-save-ui-only1/);
});
