// Safe one-employee ZKTeco pilot. Ordinary user profiles only: no biometric
// templates, face images, fingerprints, authentication secrets or mass sync.
export const PILOT_EMPLOYEE_NAME='TEST HR';
export const PILOT_FORMATS=Object.freeze(['USERINFO','USER_AC_PUSH']);
const clean=v=>String(v??'').trim();
export function validPilotPin(v){return /^[1-9][0-9]{0,8}$/.test(clean(v))}
export function pilotCommand({pin,name,format='USERINFO'}){
  const id=clean(pin),label=clean(name);
  if(!validPilotPin(id))throw new Error('Некорректный PIN ZKTeco');
  if(!label||label.length>35||/[\r\n\t=\\]/.test(label))throw new Error('Небезопасное имя пользователя ZKTeco');
  if(format==='USERINFO')return `DATA UPDATE USERINFO PIN=${id}\tName=${label}\tPrivilege=0\tCard=`;
  if(format==='USER_AC_PUSH')return `DATA UPDATE user Pin=${id}\tName=${label}\tPasswd=\tCard=\tGroup=1\tPri=0`;
  throw new Error('Неподдерживаемый формат ADMS');
}
export async function ensurePilotTables(db){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_employee_pins(
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,pin TEXT NOT NULL,
      created_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id),UNIQUE(user_id,pin)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_pilot_provisioning(
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,
      pin TEXT NOT NULL,format TEXT NOT NULL DEFAULT 'USERINFO',command_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',return_code TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id,iiko_employee_id)
    )`)
  ]);
}
export async function proposePilotPin(db,userId,employee){
  const id=clean(employee.iiko_employee_id),code=clean(employee.employee_code);
  if(!id)throw new Error('Отсутствует ID сотрудника');
  const existing=await db.prepare(`SELECT pin FROM hr_zkteco_employee_pins
    WHERE user_id=?1 AND iiko_employee_id=?2`).bind(userId,id).first();
  if(existing)return existing.pin;
  // No PIN may belong to a different employee in the network, including
  // manual binding. Old numeric HR code is a candidate only, not a guarantee.
  const peers=await db.prepare(`SELECT iiko_employee_id,employee_code FROM hr_employees
    WHERE user_id=?1 AND is_deleted=0`).bind(userId).all();
  const claimed=await db.prepare(`SELECT pin,iiko_employee_id FROM hr_zkteco_employee_pins
    WHERE user_id=?1`).bind(userId).all();
  const bindings=await db.prepare(`SELECT external_employee_id,iiko_employee_id FROM hr_employee_device_bindings
    WHERE user_id=?1`).bind(userId).all();
  const sameCode=(peers.results||[]).filter(x=>clean(x.employee_code)===code);
  const claimedPins=new Map((claimed.results||[]).map(x=>[clean(x.pin),clean(x.iiko_employee_id)]));
  const occupied=new Map();
  for(const row of bindings.results||[]){
    const pin=clean(row.external_employee_id),who=clean(row.iiko_employee_id);
    if(occupied.has(pin)&&occupied.get(pin)!==who)occupied.set(pin,'CONFLICT');
    else occupied.set(pin,who);
  }
  const canUse=pin=>validPilotPin(pin)&&
    (!claimedPins.has(pin)||claimedPins.get(pin)===id)&&
    (!occupied.has(pin)||occupied.get(pin)===id)&&
    !(peers.results||[]).some(e=>clean(e.employee_code)===pin&&clean(e.iiko_employee_id)!==id);
  let pin=code&&sameCode.length===1&&canUse(code)?code:'';
  if(!pin){
    for(let n=900001;n<1000000;n++)if(canUse(String(n))){pin=String(n);break}
  }
  if(!pin)throw new Error('Не найден свободный PIN ZKTeco; нужна ручная проверка');
  return pin;
}
export async function reservePilotPin(db,userId,employee){
  const id=clean(employee.iiko_employee_id);
  const pin=await proposePilotPin(db,userId,employee);
  await db.prepare(`INSERT OR IGNORE INTO hr_zkteco_employee_pins(user_id,iiko_employee_id,pin,created_at)
    VALUES(?1,?2,?3,?4)`).bind(userId,id,pin,new Date().toISOString()).run();
  const committed=await db.prepare(`SELECT pin FROM hr_zkteco_employee_pins
    WHERE user_id=?1 AND iiko_employee_id=?2`).bind(userId,id).first();
  if(!committed||committed.pin!==pin)throw new Error('PIN изменился во время сохранения; обновите предпросмотр');
  return pin;
}
export async function pilotCommandAcknowledged(db,{userId,deviceId,commandId,returnCode}){
  await ensurePilotTables(db);
  const job=await db.prepare(`SELECT iiko_employee_id,pin,command_id,status
    FROM hr_zkteco_pilot_provisioning
    WHERE user_id=?1 AND device_id=?2 AND command_id=?3 LIMIT 1`)
    .bind(userId,deviceId,commandId).first();
  if(!job||job.status==='ACK_SUCCESS'||job.status==='ACK_FAILED')return null;
  const ok=String(returnCode).trim()==='0';
  const state=ok?'ACK_SUCCESS':'ACK_FAILED',t=new Date().toISOString();
  await db.prepare(`UPDATE hr_zkteco_pilot_provisioning SET status=?4,return_code=?5,updated_at=?6
    WHERE user_id=?1 AND device_id=?2 AND command_id=?3`)
    .bind(userId,deviceId,commandId,state,String(returnCode??''),t).run();
  if(ok){
    // Collision safety: never replace an existing user/device association
    // with an arbitrary PIN or overwrite another employee's binding.
    const conflict=await db.prepare(`SELECT iiko_employee_id FROM hr_employee_device_bindings
      WHERE user_id=?1 AND device_id=?2 AND external_employee_id=?3 LIMIT 1`)
      .bind(userId,deviceId,job.pin).first();
    if(conflict&&clean(conflict.iiko_employee_id)!==clean(job.iiko_employee_id)){
      await db.prepare(`UPDATE hr_zkteco_pilot_provisioning SET status='BINDING_CONFLICT'
        WHERE user_id=?1 AND device_id=?2 AND command_id=?3`)
        .bind(userId,deviceId,commandId).run();
      return{status:'BINDING_CONFLICT'};
    }
    const old=await db.prepare(`SELECT external_employee_id FROM hr_employee_device_bindings
      WHERE user_id=?1 AND device_id=?2 AND iiko_employee_id=?3`)
      .bind(userId,deviceId,job.iiko_employee_id).first();
    if(old&&clean(old.external_employee_id)!==clean(job.pin)){
      await db.prepare(`UPDATE hr_zkteco_pilot_provisioning SET status='BINDING_CONFLICT'
        WHERE user_id=?1 AND device_id=?2 AND command_id=?3`)
        .bind(userId,deviceId,commandId).run();
      return{status:'BINDING_CONFLICT'};
    }
    await db.prepare(`INSERT INTO hr_employee_device_bindings(user_id,device_id,iiko_employee_id,
      provider,external_employee_id,external_label,created_at,updated_at)
      VALUES(?1,?2,?3,'ZKTECO',?4,'Pilot: ZKTeco provisioned user',?5,?5)
      ON CONFLICT(user_id,device_id,iiko_employee_id) DO UPDATE SET updated_at=excluded.updated_at`)
      .bind(userId,deviceId,job.iiko_employee_id,job.pin,t).run();
    // Do not relabel old unmatched punches: that PIN may have belonged to
    // another person before this enrollment. HR must audit old events manually.
  }
  return{status:state,pin:job.pin};
}
