import test from "node:test";
import assert from "node:assert/strict";
import {matchStoresForDepartments} from "../functions/api/iiko/_lib/store-scope.js";

const central="central-rms",restaurant="restaurant-rms";
test("iikoChain departments hierarchy can supply STORE when /corporation/stores is empty",()=>{
  const result=matchStoresForDepartments(
    {stores:[],nodes:[]},
    {stores:[{id:"central-store",type:"STORE",parentId:central,name:"Центральный склад"}],
     nodes:[{id:central,type:"DEPARTMENT",parentId:"corp"},{id:"central-store",type:"STORE",parentId:central}]},
    [central]
  );
  assert.equal(result.matched.length,1);
  assert.equal(result.matched[0].name,"Центральный склад");
  assert.equal(result.departmentStoreCount,1);
});
test("nested central-store nodes under RMS resolve through parent chain",()=>{
  const result=matchStoresForDepartments(
    {stores:[{id:"store-b",type:"STORE",parentId:"centralstore-node",name:"Основной"}],nodes:[]},
    {stores:[],nodes:[{id:"centralstore-node",parentId:central,type:"CENTRALSTORE"},{id:central,parentId:"corp",type:"DEPARTMENT"}]},
    [central]
  );
  assert.deepEqual(result.matched.map(x=>x.id),["store-b"]);
});
test("separate RMS warehouses are not exposed to central RMS",()=>{
  const result=matchStoresForDepartments(
    {stores:[{id:"central-store",parentId:central},{id:"restaurant-store",parentId:restaurant}],nodes:[]},
    {stores:[],nodes:[{id:central,type:"DEPARTMENT"},{id:restaurant,type:"DEPARTMENT"}]},
    [central]
  );
  assert.deepEqual(result.matched.map(x=>x.id),["central-store"]);
});
test("department hierarchy restores missing parent for same store returned by stores endpoint",()=>{
  const result=matchStoresForDepartments(
    {stores:[{id:"central-store",name:"Из stores endpoint",parentId:""}],nodes:[{id:"central-store",parentId:"",type:"STORE"}]},
    {stores:[{id:"central-store",name:"Из иерархии",parentId:central}],nodes:[{id:central,type:"DEPARTMENT",parentId:"corp"},{id:"central-store",type:"STORE",parentId:central}]},
    [central]
  );
  assert.equal(result.stores.length,1);
  assert.deepEqual(result.matched.map(x=>x.id),["central-store"]);
  assert.equal(result.matched[0].parentId,central);
});
test("missing authoritative warehouse ownership is not guessed from name",()=>{
  const result=matchStoresForDepartments(
    {stores:[{id:"X",name:"Mərkəzi Anbar",parentId:""}],nodes:[]},
    {stores:[],nodes:[{id:central,name:"Mərkəzi Anbar",type:"DEPARTMENT"}]},
    [central]
  );
  assert.equal(result.matched.length,0);
});
