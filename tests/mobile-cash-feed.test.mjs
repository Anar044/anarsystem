import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedCashPlugins, normalizePosOrders } from '../functions/api/mobile/v1/cash.js';

test('server accepts only online plugins assigned to selected restaurants', () => {
  const items = authorizedCashPlugins({
    plugins: [
      {pluginId:'r1',departmentId:'RMS1',online:true,groupName:'RMS 1'},
      {pluginId:'r2',departmentId:'RMS2',online:true,groupName:'TESTING KASSA'},
      {pluginId:'foreign',departmentId:'OTHER',online:true},
      {pluginId:'off',departmentId:'RMS1',online:false},
      {pluginId:'r1',departmentId:'RMS1',online:true},
      {pluginId:'no-dept',online:true}
    ]},['RMS1','RMS2']);
  assert.deepEqual(items.map(p=>p.id),['r1','r2']);
  assert.deepEqual(items.map(p=>p.departmentId),['RMS1','RMS2']);
  assert.equal(items[0].name,'RMS 1');
});
test('invalid feed cannot be mislabeled as no online cash registers', () => {
  assert.throws(()=>authorizedCashPlugins({},['RMS1']),e=>e.code==='CASH_PLUGIN_FEED_INVALID');
});
test('POS orders normalize from terminal sections including closed and open', () => {
  const data={data:{terminalsGroups:[{restaurantSections:[{
    restaurantSectionName:'zal',
    orders:[{
      orderNum:'1',orderStatus:'closed',
      orderExpectedRevenue:12,orderTables:'1'
    },{
      orderNum:'3',orderStatus:'open',
      orderExpectedRevenue:12
    }],
    deliveries:[],
    reserves:[]
  }]}]}};
  const result=normalizePosOrders(data);
  assert.equal(result.length,2);
  assert.equal(result[0].amount,12);
  assert.equal(result[0].status,'CLOSED');
  assert.equal(result[1].status,'OPEN');
});
test('malformed VPS JSON is rejected, not interpreted as empty registers',()=>{
  assert.throws(()=>normalizePosOrders({status:'ok'}),
      e=>e.code==='CASH_ORDERS_FORMAT_UNAVAILABLE');
});
