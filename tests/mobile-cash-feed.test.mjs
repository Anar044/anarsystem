import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedCashPlugins, normalizePosOrders, cashFeedSnapshot } from '../functions/api/mobile/v1/cash.js';

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

test("one failed POS leaves responding POS visible without network totals",()=>{
 const plugins=[{name:"POS A",departmentId:"r1"},{name:"POS B",departmentId:"r2"}];
 const snapshot=cashFeedSnapshot(plugins,[
   {status:"fulfilled",value:{name:"POS A",departmentId:"r1",orders:[
     {status:"CLOSED",amount:100}] }},
   {status:"rejected",reason:new Error("timeout")}
 ],["r1","r2"]);
 assert.equal(snapshot.partial,true);
 assert.equal(snapshot.count,1);
 assert.equal(snapshot.totals,null);
 assert.equal(snapshot.unavailableRegisters[0].departmentId,"r2");
});
test("all unreachable cash registers produce an error, not false zero revenue",()=>{
 assert.throws(()=>cashFeedSnapshot(
   [{name:"POS A",departmentId:"r1"}],
   [{status:"rejected",reason:new Error("timeout")}],["r1"]),
   e=>e.code==="CASH_ALL_UNAVAILABLE");
});

test('selected CHAIN department without POS online has unknown network totals',()=>{
 const info=cashFeedSnapshot([{name:'POS1',departmentId:'RMS1'}],[
   {status:'fulfilled',value:{name:'POS1',departmentId:'RMS1',
     orders:[{status:'CLOSED',amount:243}]}}
 ],['RMS1','RMS2']);
 assert.equal(info.partial,true);
 assert.deepEqual(info.missingDepartmentIds,['RMS2']);
 assert.equal(info.totals,null);
 assert.equal(info.registers[0].orders[0].amount,243);
});
