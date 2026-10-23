import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedCashPlugins, normalizePosOrders, cashFeedSnapshot, settleCashBatched } from '../functions/api/mobile/v1/cash.js';

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
      orderExpectedRevenue:12,orderTables:'1',
      orderOpenDate:'2026-10-16T10:00:00',
      orderCloseTime:'2026-10-16T10:30:00'
    },{
      orderNum:'3',orderStatus:'open',
      orderExpectedRevenue:12,orderOpenDate:'2026-10-16T11:00:00'
    }],
    deliveries:[],
    reserves:[]
  }]}]}};
  const result=normalizePosOrders(data);
  assert.equal(result.length,2);
  assert.equal(result[0].amount,12);
  assert.equal(result[0].status,'CLOSED');
  assert.equal(result[0].floor,'zal');
  assert.equal(result[0].openedAt,'2026-10-16T10:00:00');
  assert.equal(result[0].closedAt,'2026-10-16T10:30:00');
  assert.equal(result[1].status,'OPEN');
  assert.equal(result[1].floor,'zal');
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

test("partial POS data exposes honest available-register subtotals",()=>{
 const plugins=[{id:"one",name:"POS 1",departmentId:"r1"}];
 const settled=[{status:"fulfilled",value:{
   ...plugins[0],
   orders:[{status:"CLOSED",amount:100},{status:"OPEN",amount:30}],
   totals:{closedSum:100,openSum:30}
 }}];
 const snapshot=cashFeedSnapshot(plugins,settled,["r1","r2"]);
 assert.equal(snapshot.partial,true);
 assert.equal(snapshot.totals,null);
 assert.equal(snapshot.availableTotals.closedSum,100);
 assert.equal(snapshot.availableTotals.openSum,30);
 assert.equal(snapshot.availableTotals.totalOrders,2);
 assert.equal(snapshot.totalsCoverage,"ONLINE_REGISTERS_ONLY");
});

test("offline POS snapshot remains listed but does not inflate online totals",()=>{
 const now="2026-10-16T17:00:00.000Z";
 const live=[{id:"online",departmentId:"r1",name:"Online",
  orders:[{status:"CLOSED",amount:90}]}];
 const snapshots=[{id:"offline",departmentId:"r2",name:"Old POS",online:false,
  lastSeenAt:"2026-10-16T15:00:00.000Z",orders:[
    {number:"44",status:"CLOSED",amount:500}
  ],totals:{closedSum:500,expectedSum:500,totalOrders:1}}];
 const output=cashFeedSnapshot(live,[{status:"fulfilled",value:{
  ...live[0],totals:{closedSum:90,openSum:0,expectedSum:90,totalOrders:1}
 }}],["r1","r2"],snapshots,{seenAt:now});
 assert.equal(output.onlineCount,1);
 assert.equal(output.offlineCount,1);
 assert.equal(output.registers.length,2);
 assert.equal(output.registers[1].online,false);
 assert.equal(output.registers[1].lastSeenAt,"2026-10-16T15:00:00.000Z");
 assert.equal(output.availableTotals.closedSum,90);
 assert.equal(output.totals,null);
 assert.equal(output.partial,true);
});
test("offline only is not presented as zero current revenue",()=>{
 const old=[{id:"old",departmentId:"r1",name:"Old",
  lastSeenAt:"2026-10-16T12:00:00Z",
  totals:{closedSum:300},orders:[]}];
 const result=cashFeedSnapshot([],[],["r1"],old,{feedAvailable:false});
 assert.equal(result.onlineCount,0);
 assert.equal(result.offlineCount,1);
 assert.equal(result.totals,null);
 assert.equal(result.availableTotals,null);
 assert.equal(result.registers[0].totals.closedSum,300);
});
test("historical snapshots for unselected restaurants never reach response",()=>{
 const old=[{id:"foreign",departmentId:"r3",totals:{closedSum:999}}];
 const result=cashFeedSnapshot([],[],["r1"],old,{feedAvailable:false});
 assert.equal(result.registers.length,0);
 assert.equal(result.totals,null);
});

test('13 selected restaurants load without rejecting legitimate POS scope', async () => {
  const ids = Array.from({length: 13}, (_, index) => 'RMS'+(index+1));
  const payload = {plugins: ids.map((departmentId,index)=>({
    pluginId: 'POS'+index, departmentId, online:true,
    groupName: 'Register '+(index+1)
  })).concat([{pluginId:'outsider',departmentId:'OTHER',online:true}])};
  const authorized = authorizedCashPlugins(payload,ids);
  assert.equal(authorized.length,13);
  const collected=await settleCashBatched(authorized,async plugin=>({
    ...plugin,orders:[{number:'1',status:'CLOSED',amount:10}],
    totals:{closedSum:10,openSum:0,expectedSum:10,totalOrders:1}
  }));
  const output=cashFeedSnapshot(authorized,collected,ids);
  assert.equal(output.registers.length,13);
  assert.equal(output.partial,false);
  assert.equal(output.totalsCoverage,'ALL_SELECTED_RESTAURANTS');
  assert.equal(output.availableTotals.closedSum,130);
  assert.equal(output.registers.some(p=>p.id==='outsider'),false);
});

test('25 POS use no more than five concurrent requests; rejected requests stay partial', async () => {
  const ids=Array.from({length:25},(_,i)=>'POS'+i);
  let active=0,maximum=0;
  const result=await settleCashBatched(ids, async id=>{
    active++;
    maximum=Math.max(maximum,active);
    await Promise.resolve();
    active--;
    if(id==='POS11')throw new Error('unavailable');
    return {id,departmentId:id,name:id,orders:[]};
  },20);
  assert.equal(result.length,25);
  assert.ok(maximum<=5);
  assert.ok(maximum>1);
  assert.equal(result[11].status,'rejected');
  assert.equal(result[12].status,'fulfilled');
  assert.equal(result[12].value.id,'POS12');
  const snapshot=cashFeedSnapshot(ids.map(id=>({id,departmentId:id,name:id})),
    result,ids);
  assert.equal(snapshot.partial,true);
  assert.equal(snapshot.count,24);
  assert.equal(snapshot.totals,null);
  assert.equal(snapshot.unavailableRegisters.length,1);
  assert.equal(snapshot.unavailableRegisters[0].id,'POS11');
});

test('no fabricated live totals when a large POS selection has zero responses', async()=>{
  const ids=Array.from({length:17},(_,i)=>'POS'+i);
  const result=await settleCashBatched(ids,async()=>{throw Error('unavailable');});
  assert.throws(()=>cashFeedSnapshot(
    ids.map(id=>({id,departmentId:id,name:id})),result,ids
  ),e=>e.code==='CASH_ALL_UNAVAILABLE');
});
