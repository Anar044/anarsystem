import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateManualPunchCorrection } from '../functions/api/hr/_lib/punch-correction.js';

const iso = value => new Date(value + ':00+04:00').toISOString();
function mockDb({events=[],shiftType='DAY',department='A',role='CASHIER'}={}){
  return {
    prepare(sql){
      return {
        bind(...args){
          return {
            async first(){
              if(sql.includes('FROM hr_employees'))return{iiko_employee_id:args[1],role_code:role,department_code:department};
              if(sql.includes('FROM hr_role_attendance_rules'))return{shift_type:shiftType};
              if(sql.includes('FROM hr_employee_attendance_rules'))return{shift_type_override:''};
              throw new Error('Unexpected first query: '+sql);
            },
            async all(){
              assert.match(sql,/FROM hr_attendance_events/);
              return{results:events.filter(e=>e>=args[2]&&e<args[3]).sort().map(event_time=>({event_time}))};
            }
          };
        }
      };
    }
  };
}
const opts=(db,extra={})=>({db,userId:'owner',employeeId:'employee1',workDate:'2026-10-08',scope:null,firstText:'',lastText:'',...extra});
test('correct day departure using first real punch, ignoring 10 second duplicate',async()=>{
  const db=mockDb({events:[iso('2026-10-08T07:00'),iso('2026-10-08T07:00'),iso('2026-10-08T18:00')]});
  const result=await calculateManualPunchCorrection(db,opts(db,{lastText:'2026-10-08T19:30'}));
  assert.equal(result.firstInOverride,'');
  assert.equal(result.lastOutOverride,iso('2026-10-08T19:30'));
  assert.equal(result.workedMinutesOverride,12*60+30);
});
test('night departure next day stays in original work date',async()=>{
  const db=mockDb({shiftType:'NIGHT',events:[iso('2026-10-08T22:00')]});
  const result=await calculateManualPunchCorrection(db,opts(db,{lastText:'2026-10-09T08:00'}));
  assert.equal(result.workedMinutesOverride,10*60);
});
test('one punch without completed exit stays incomplete',async()=>{
  const db=mockDb({events:[iso('2026-10-08T08:00')]});
  await assert.rejects(()=>calculateManualPunchCorrection(db,opts(db,{firstText:'2026-10-08T07:00'})),/неполной явки/i);
});
test('HR can manually supply both times for a day with no device marks',async()=>{
  const db=mockDb();
  const result=await calculateManualPunchCorrection(db,opts(db,{firstText:'2026-10-08T10:00',lastText:'2026-10-08T19:00'}));
  assert.equal(result.workedMinutesOverride,540);
});
test('day shift rejects a punch before 05:00 on opening day',async()=>{
  const db=mockDb();
  await assert.rejects(()=>calculateManualPunchCorrection(db,opts(db,{firstText:'2026-10-08T04:59',lastText:'2026-10-08T15:00'})),/вне окна смены/);
});
test('night shift allows until 11:59 but rejects 12:00 next day',async()=>{
  const db=mockDb({shiftType:'NIGHT'});
  await assert.rejects(()=>calculateManualPunchCorrection(db,opts(db,{firstText:'2026-10-08T12:00',lastText:'2026-10-09T12:00'})),/вне окна смены/);
});
test('exit earlier than arrival is rejected',async()=>{
  const db=mockDb();
  await assert.rejects(()=>calculateManualPunchCorrection(db,opts(db,{firstText:'2026-10-08T18:00',lastText:'2026-10-08T09:00'})),/позже прихода/);
});
test('CHAIN restaurant scope cannot modify another restaurant employee',async()=>{
  const db=mockDb({department:'B'});
  const scope={isChain:true,allowedDepartmentIds:['A','B'],selectedDepartmentIds:['A'],selectedDepartmentCodes:['A']};
  await assert.rejects(()=>calculateManualPunchCorrection(db,opts(db,{scope,firstText:'2026-10-08T07:00',lastText:'2026-10-08T19:00'})),/другому ресторану/);
});
