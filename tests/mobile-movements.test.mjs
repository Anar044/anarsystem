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

test("movement totals are scoped and unknown inventory difference stays unknown",()=>{
 const result=scopedMovements({
  success:true,
  movements:[
   {id:"in-1",type:"incoming",label:"Приход",storeId:"A",storeName:"Main",
    productId:"p1",productName:"Coffee",amount:10,signedAmount:10,value:100},
   {id:"inv-1",type:"inventory",label:"Инвентаризация",storeId:"A",
    productId:"p2",productName:"Sugar",amount:3,signedAmount:null,value:15}
  ],
  sourceStatus:{
   incoming:{ok:true,count:1,attempts:[]},
   outgoing:{ok:true,count:0,attempts:[]},
   writeoff:{ok:false,count:0,attempts:[]},
   transfer:{ok:true,count:0,attempts:[]},
   inventory:{ok:true,count:1,attempts:[]}
  }
 },["A"],["dept1"]);
 assert.equal(result.summary.incoming,100);
 assert.equal(result.summary.writeoff,null);
 assert.equal(result.rows.find(r=>r.type==="inventory").quantity,null);
 assert.equal(result.sourceStatus.writeoff.ok,false);
 assert.deepEqual(result.missingSources,["writeoff"]);
});
test("same-chain transfer includes from/to warehouse names",()=>{
 const result=scopedMovements({
  success:true,movements:[{
   id:"tr",type:"transfer",storeId:"",fromStoreId:"A",fromStoreName:"Main",
   toStoreId:"B",toStoreName:"Bar",productId:"p",productName:"Milk",
   amount:2,value:16
  }],sourceStatus:{transfer:{ok:true,count:1,attempts:[]}}
 },["A","B"],["dept1"]);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].fromStoreName,"Main");
 assert.equal(result.rows[0].toStoreName,"Bar");
});
