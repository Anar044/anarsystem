import test from "node:test";
import assert from "node:assert/strict";
import { scopedMovements } from "../functions/api/mobile/v1/movements.js";

const sample={success:true,movements:[
  {id:"1",storeId:"A",productId:"1",productName:"Rice",amount:5,value:40},
  {id:"2",fromStoreId:"A",toStoreId:"B",productId:"1",productName:"Rice",amount:2,value:16},
  {id:"3",storeId:"B",productId:"2",productName:"Milk",amount:1,value:6},
]};
test("movements exclude other restaurants and cross restaurant transfers",()=>{
  const out=scopedMovements(sample,["A"],["dept1"]);
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].id,"1");
  assert.equal(out.selectedDepartmentIds[0],"dept1");
});
test("no verified stores means no movements are exposed",()=>{
 assert.throws(()=>scopedMovements(sample,[],["dept1"]),/Склады/);
});

test("partial movement feed preserves scoped rows and lists missing sources",()=>{
  const result=scopedMovements({
    ...sample,
    sourceStatus:{
      incoming:{ok:true}, outgoing:{ok:false},
      writeoff:{ok:true},transfer:{ok:true},inventory:{ok:false}
    }
  },["A"],["dept1"]);
  assert.equal(result.rows.length,1);
  assert.equal(result.partial,true);
  assert.deepEqual(result.missingSources,["outgoing","inventory"]);
  assert.equal(result.totalValue,undefined);
});
test("all successful movement sources are flagged as complete",()=>{
  const x=scopedMovements({...sample,sourceStatus:{
    incoming:{ok:true},outgoing:{ok:true}
  }},["A"],["dept1"]);
  assert.equal(x.partial,false);
});
