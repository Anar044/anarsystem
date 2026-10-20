import test from "node:test";
import assert from "node:assert/strict";
import { restaurantPosStatuses } from "../functions/api/mobile/_lib/restaurant-pos.js";

const authorized = [
  {id:"r1",name:"Working restaurant"},
  {id:"r2",name:"No POS configured"},
  {id:"r3",name:"No known topology"}
];
test("classifies only authorized restaurants using configured POS group association", () => {
  const topology = {
    identity:{
      groups:[
        {id:"g1",departmentId:"r1"},
        {id:"g2",departmentId:"r2"},
        {id:"foreign-group",departmentId:"foreign"}
      ],
      pointsOfSale:[
        {id:"p1",groupId:"g1"},
        {id:"p1",groupId:"g1"},
        {id:"p2",groupId:"foreign-group"}
      ]
    }
  };
  const classified=restaurantPosStatuses(topology,authorized);
  assert.deepEqual(classified.r1,{posStatus:"with_pos",posCount:1});
  assert.deepEqual(classified.r2,{posStatus:"without_pos",posCount:0});
  assert.deepEqual(classified.r3,{posStatus:"unknown",posCount:0});
  assert.equal(Object.hasOwn(classified,"foreign"),false);
});
test("no trustworthy POS topology never falsely declares restaurant inactive", () => {
  const result=restaurantPosStatuses({connection:{departments:authorized}},authorized);
  for(const r of authorized)assert.equal(result[r.id].posStatus,"unknown");
});
test("POS belonging to another group is not silently assigned to a restaurant", () => {
  const result=restaurantPosStatuses({
    connection:{
      groups:[{id:"g1",departmentId:"r1"},{id:"g2",departmentId:"r2"}],
      pointsOfSale:[{id:"p2",groupId:"g2"}]
    }
  },authorized);
  assert.equal(result.r1.posStatus,"without_pos");
  assert.equal(result.r2.posStatus,"with_pos");
});
test("nothing in revenue, business date or shift status affects configured POS", () => {
  const topology={identity:{
    groups:[{id:"g1",departmentId:"r1"}],
    pointsOfSale:[{id:"p1",groupId:"g1"}]
  }};
  assert.equal(restaurantPosStatuses(topology,authorized).r1.posStatus,"with_pos");
});
