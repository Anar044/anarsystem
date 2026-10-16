import test from "node:test";
import assert from "node:assert/strict";
import {savedPosRegister,savePosSnapshots,loadPosSnapshots,
  MAX_SAVED_ORDERS} from "../functions/api/mobile/_lib/cash-snapshots.js";

function d1Mock(){
 const stored=new Map();
 return {
  stored,
  prepare(sql){
   return {
    async run(){return {success:true}},
    bind(...args){
     return {
      async run(){
       if(sql.includes("INSERT INTO")){
        const [workspaceId,departmentId,pluginId,lastSeenAt,snapshotJson]=args;
        stored.set([workspaceId,departmentId,pluginId].join("|"),
          {workspace_id:workspaceId,department_id:departmentId,
          plugin_id:pluginId,last_seen_at:lastSeenAt,snapshot_json:snapshotJson});
       }
       return {success:true};
      },
      async all(){
       return {results:[...stored.values()].filter(row=>
         row.workspace_id===args[0] && args.slice(1).includes(row.department_id))};
      }
     };
    }
   };
  }
 };
}
test("POS snapshots store the newest orders and preserve real complete totals",()=>{
 const orders=Array.from({length:205},(_,i)=>({
  number:String(i),openedAt:`2026-10-16T${String(Math.floor(i/60)).padStart(2,"0")}:${String(i%60).padStart(2,"0")}:00Z`
 }));
 const snapshot=savedPosRegister({id:"pos1",departmentId:"r1",
   name:"Cash 1",orders,totals:{closedSum:123456,totalOrders:205}},
   "2026-10-16T20:00:00Z");
 assert.equal(snapshot.orders.length,MAX_SAVED_ORDERS);
 assert.equal(snapshot.savedOrderCount,205);
 assert.equal(snapshot.ordersTruncated,true);
 assert.equal(snapshot.orders[0].number,"204");
 assert.equal(snapshot.totals.closedSum,123456);
});
test("D1 POS snapshots are isolated by verified workspace AND department",async()=>{
 const db=d1Mock();
 const register={id:"p1",departmentId:"r1",name:"R1",orders:[],
   totals:{closedSum:88}};
 await savePosSnapshots(db,"org-1",[register],"2026-10-16T20:00:00Z");
 await savePosSnapshots(db,"org-2",[{...register,departmentId:"r2",
  totals:{closedSum:900}}],"2026-10-16T20:01:00Z");
 const visible=await loadPosSnapshots(db,"org-1",["r1"]);
 assert.equal(visible.length,1);
 assert.equal(visible[0].totals.closedSum,88);
 assert.equal(visible[0].lastSeenAt,"2026-10-16T20:00:00Z");
 assert.equal((await loadPosSnapshots(db,"org-1",["r2"])).length,0);
 assert.equal((await loadPosSnapshots(db,"org-2",["r1"])).length,0);
});
