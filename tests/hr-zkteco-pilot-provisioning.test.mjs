import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PILOT_EMPLOYEE_NAME,pilotCommand,validPilotPin,proposePilotPin,reservePilotPin,pilotCommandAcknowledged} from '../functions/api/hr/_lib/zkteco-pilot.js';

test('Pilot supports standard TA PUSH and alternate AC PUSH user formats with same network PIN',()=>{
  assert.equal(PILOT_EMPLOYEE_NAME,'TEST HR');
  assert.equal(pilotCommand({pin:'3',name:'TEST HR'}),
    'DATA UPDATE USERINFO PIN=3\tName=TEST HR\tPrivilege=0\tCard=');
  assert.equal(pilotCommand({pin:'3',name:'TEST HR',format:'USER_AC_PUSH'}),
    'DATA UPDATE user Pin=3\tName=TEST HR\tPasswd=\tCard=\tGroup=1\tPri=0');
  for(const bad of ['0','03','-1','1\nDATA DELETE USERINFO PIN=1','9999999999']){
    assert.equal(validPilotPin(bad),false);
  }
  assert.throws(()=>pilotCommand({pin:'3',name:'TEST HR\nDATA DELETE user Pin=2'}));
  assert.throws(()=>pilotCommand({pin:'3',name:'TEST HR',format:'UNKNOWN'}));
});

function fakeDb(){
  const state={
    employee:[{iiko_employee_id:'farid',employee_code:'3'},{iiko_employee_id:'other',employee_code:'7'}],
    pins:[],bindings:[],jobs:[
      {user_id:'owner',device_id:'2a',iiko_employee_id:'farid',
        pin:'3',command_id:81,status:'PENDING'}],
    modified:[],schema:0
  };
  const row=(sql,args)=>{
    if(sql.includes('FROM hr_zkteco_employee_pins')&&sql.includes('iiko_employee_id=?2'))
      return state.pins.find(x=>x.user_id===args[0]&&x.iiko_employee_id===args[1])||null;
    if(sql.includes('FROM hr_zkteco_pilot_provisioning'))
      return state.jobs.find(x=>x.user_id===args[0]&&x.device_id===args[1]&&x.command_id===args[2])||null;
    if(sql.includes('FROM hr_employee_device_bindings')&&sql.includes('external_employee_id=?3'))
      return state.bindings.find(x=>x.user_id===args[0]&&x.device_id===args[1]&&x.external_employee_id===args[2])||null;
    if(sql.includes('FROM hr_employee_device_bindings')&&sql.includes('iiko_employee_id=?3'))
      return state.bindings.find(x=>x.user_id===args[0]&&x.device_id===args[1]&&x.iiko_employee_id===args[2])||null;
    throw new Error('Unexpected first '+sql);
  };
  const list=(sql,args)=>{
    if(sql.includes('FROM hr_employees'))return state.employee;
    if(sql.includes('FROM hr_zkteco_employee_pins'))return state.pins.filter(x=>x.user_id===args[0]);
    if(sql.includes('FROM hr_employee_device_bindings'))return state.bindings.filter(x=>x.user_id===args[0]);
    throw new Error('Unexpected all '+sql);
  };
  const db={
    prepare(sql){return{bind(...args){return{
      first:async()=>row(sql,args),
      all:async()=>({results:list(sql,args)}),
      run:async()=>{
        state.modified.push(sql);
        if(sql.startsWith('INSERT OR IGNORE INTO hr_zkteco_employee_pins')){
          const [user_id,iiko_employee_id,pin]=args;
          if(!state.pins.some(x=>x.user_id===user_id&&x.iiko_employee_id===iiko_employee_id))
            state.pins.push({user_id,iiko_employee_id,pin});
        }
        if(sql.includes('UPDATE hr_zkteco_pilot_provisioning')){
          const entry=state.jobs.find(x=>x.user_id===args[0]&&x.device_id===args[1]&&x.command_id===args[2]);
          if(entry){entry.status=sql.includes("status='BINDING_CONFLICT'")?'BINDING_CONFLICT':args[3];}
        }
        if(sql.includes('INSERT INTO hr_employee_device_bindings')){
          state.bindings.push({user_id:args[0],device_id:args[1],iiko_employee_id:args[2],external_employee_id:args[3]});
        }
        return{success:true};
      }
    }}};},
    async batch(stmts){state.schema+=stmts.length;return []}
  };
  return{db,state};
}
test('Network PIN uses unique employee code, otherwise a high reserved free ID',async()=>{
  const {db,state}=fakeDb();
  const employee={iiko_employee_id:'farid',employee_code:'3'};
  assert.equal(await proposePilotPin(db,'owner',employee),'3');
  assert.equal(state.pins.length,0,'Preview must not mutate database');
  assert.equal(await reservePilotPin(db,'owner',employee),'3');
  assert.equal(state.pins.length,1);
  assert.equal(await reservePilotPin(db,'owner',employee),'3');
  state.pins.length=0;
  state.employee.push({iiko_employee_id:'dup',employee_code:'3'});
  assert.equal(await proposePilotPin(db,'owner',employee),'900001');
});
test('Success ACK binds only current employee/device/PIN; no retroactive changes to attendance',async()=>{
  const {db,state}=fakeDb();
  const response=await pilotCommandAcknowledged(db,{userId:'owner',deviceId:'2a',commandId:81,returnCode:'0'});
  assert.equal(response.status,'ACK_SUCCESS');
  assert.equal(state.jobs[0].status,'ACK_SUCCESS');
  assert.equal(state.bindings.length,1);
  assert.deepEqual(state.bindings[0],{user_id:'owner',device_id:'2a',iiko_employee_id:'farid',external_employee_id:'3'});
  assert.ok(!state.modified.some(sql=>sql.includes('UPDATE hr_attendance_events')));
  assert.equal(await pilotCommandAcknowledged(db,{userId:'owner',deviceId:'2a',commandId:81,returnCode:'0'}),null);
  assert.equal(state.bindings.length,1,'Duplicate ACK must not create duplicate binding');
});
test('Failure ACK never activates attendance mapping; unrelated commands do nothing',async()=>{
  const {db,state}=fakeDb();
  const unrelated=await pilotCommandAcknowledged(db,{userId:'owner',deviceId:'2a',commandId:1000,returnCode:'0'});
  assert.equal(unrelated,null);
  const response=await pilotCommandAcknowledged(db,{userId:'owner',deviceId:'2a',commandId:81,returnCode:'-1002'});
  assert.equal(response.status,'ACK_FAILED');
  assert.equal(state.bindings.length,0);
});
test('ACK success does not overwrite a different employee with same device PIN',async()=>{
  const {db,state}=fakeDb();
  state.bindings.push({user_id:'owner',device_id:'2a',iiko_employee_id:'other',external_employee_id:'3'});
  const response=await pilotCommandAcknowledged(db,{userId:'owner',deviceId:'2a',commandId:81,returnCode:'0'});
  assert.equal(response.status,'BINDING_CONFLICT');
  assert.equal(state.bindings.length,1);
});
test('Central HR only, two online devices and exact PIN confirmation are enforced',()=>{
  const route=readFileSync(new URL('../functions/api/hr/timeclock.js',import.meta.url),'utf8');
  const adms=readFileSync(new URL('../functions/api/hr/_lib/zkteco-adms.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../hr-timeclock.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../hr-timeclock.html',import.meta.url),'utf8');
  assert.match(route,/pilotPrepareTestHr/);
  assert.match(route,/pilotProvisionTestHr/);
  assert.match(route,/!isTimeclockScopeRestricted\(scope\)/);
  assert.match(route,/confirmFreePin!==true/);
  assert.match(route,/expectedPin/);
  assert.match(route,/queueAdmsCommand\(/);
  assert.match(adms,/pilotCommandAcknowledged/);
  assert.match(ui,/async function pilotSend/);
  assert.match(ui,/pilotPrepareTestHr/);
  assert.match(html,/tcPilotSend/);
  assert.doesNotMatch(ui,/BIODATA|FINGERTMP|FACE_TMP/);
});
