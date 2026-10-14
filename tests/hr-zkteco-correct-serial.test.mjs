import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {correctAdmsDeviceSerial} from '../functions/api/hr/_lib/zkteco-adms.js';

function fakeDb(initialSerial='6254900251',otherSerial='NYU7261304199'){
  const state={serial:initialSerial,otherSerial,
    commands:[{status:'PENDING'},{status:'SENT'},{status:'ACK'}],
    employeeBindings:3,attendanceEvents:17,rawLogs:5,returnedBatches:[]};
  const db={
    prepare(sql){return{
      bind(...args){return{
        first:async()=>{
          if(sql.includes('SELECT serial_number FROM hr_zkteco_adms_devices'))
            return args[0]==='owner'&&args[1]==='device-1'?{serial_number:state.serial}:null;
          if(sql.includes('SELECT user_id,device_id FROM hr_zkteco_adms_devices'))
            return args[0]===state.otherSerial?{user_id:'other-owner',device_id:'device-2'}:null;
          throw new Error('Unexpected SQL first: '+sql);
        },
        run:async()=>({success:true}),
        _sql:sql,_args:args
      }},
      _sql:sql
    }},
    async batch(stmts){
      state.returnedBatches.push(stmts.map(x=>x._sql||''));
      for(const row of stmts){
        if(row._sql?.includes('UPDATE hr_zkteco_adms_devices'))state.serial=row._args[2];
        if(row._sql?.includes('UPDATE hr_zkteco_adms_commands'))
          state.commands.forEach(c=>{if(['PENDING','SENT'].includes(c.status))c.status='SUPERSEDED'});
      }
      return [];
    }
  };
  return{db,state};
}
test('Fix ADMS serial in place while retaining logical device, punch and binding history',async()=>{
  const {db,state}=fakeDb();
  const result=await correctAdmsDeviceSerial(db,{userId:'owner',deviceId:'device-1',serialNumber:' vgu6254900251 '});
  assert.deepEqual(result,{changed:true,previousSerial:'6254900251',serialNumber:'VGU6254900251'});
  assert.equal(state.serial,'VGU6254900251');
  assert.equal(state.employeeBindings,3);
  assert.equal(state.attendanceEvents,17);
  assert.equal(state.rawLogs,5);
  assert.deepEqual(state.commands.map(x=>x.status),['SUPERSEDED','SUPERSEDED','ACK']);
  assert.ok(!state.returnedBatches.flat().some(sql=>/DELETE FROM hr_(attendance|employee)/.test(sql)));
});
test('Unchanged serial is idempotent; it does not supersede queued ADMS commands',async()=>{
  const {db,state}=fakeDb('VGU6254900251');
  const out=await correctAdmsDeviceSerial(db,{userId:'owner',deviceId:'device-1',serialNumber:'VGU6254900251'});
  assert.equal(out.changed,false);
  assert.deepEqual(state.commands.map(x=>x.status),['PENDING','SENT','ACK']);
});
test('Reject serial numbers belonging to another tenant, and invalid SN syntax',async()=>{
  const {db,state}=fakeDb();
  await assert.rejects(()=>correctAdmsDeviceSerial(db,{userId:'owner',deviceId:'device-1',serialNumber:state.otherSerial}),e=>e.status===409);
  await assert.rejects(()=>correctAdmsDeviceSerial(db,{userId:'owner',deviceId:'device-1',serialNumber:'abc/def'}),e=>e.status===400);
  assert.equal(state.serial,'6254900251');
});
test('Only a registered ADMS device can update the serial',async()=>{
  const {db,state}=fakeDb();
  await assert.rejects(()=>correctAdmsDeviceSerial(db,{userId:'other-owner',deviceId:'device-1',serialNumber:'VGU6254900251'}),e=>e.status===404);
  assert.equal(state.serial,'6254900251');
});
test('Timeclock UI edits the serial without deleting devices and explains independent RMS punches',()=>{
  const api=readFileSync(new URL('../functions/api/hr/timeclock.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../hr-timeclock.js',import.meta.url),'utf8');
  const page=readFileSync(new URL('../hr-timeclock.html',import.meta.url),'utf8');
  assert.match(api,/action==='correctDeviceSerial'/);
  assert.match(api,/deviceAllowedForScope\(d,scope\)/);
  assert.match(api,/correctAdmsDeviceSerial\(env.DB/);
  assert.match(api,/action==='reassignDeviceRestaurant'/);
  assert.match(api,/COUNT\(\*\) AS count FROM hr_attendance_events/);
  assert.match(api,/COUNT\(\*\) AS count FROM hr_zkteco_adms_raw/);
  assert.match(api,/!isTimeclockScopeRestricted\(scope\)/);
  assert.match(ui,/data-reassign-rms/);
  assert.match(ui,/data-correct-serial/);
  assert.match(ui,/action:'correctDeviceSerial'/);
  assert.match(page,/Явки по каждому RMS независимы/);
  assert.doesNotMatch(page,/Фактический ресторан смены определяется первым сканированием/);
});
