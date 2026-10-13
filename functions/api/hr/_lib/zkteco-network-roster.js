// Planning only: this module never sends commands, fingerprints, face templates,
// passwords, photos or enrollment data to any device.
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toUpperCase();
export function zktecoModelProfile(model){
  const code=norm(model).replace(/[\s_-]/g,'');
  if(code==='F18')return{
    key:'F18',name:'ZKTeco F18',fingerprint:true,face:false,
    fingerprintAlgorithm:'ZKFinger 9/10 (depends on firmware)',
    connection:'AC_PUSH_STANDARD_TA_PUSH_OPTIONAL',
    templateTransfer:'REQUIRES_FIRMWARE_AND_SDK_VERIFICATION'
  };
  if(code==='SENSEFACE2A')return{
    key:'SENSEFACE_2A',name:'ZKTeco SenseFace 2A',fingerprint:true,face:true,
    fingerprintAlgorithm:'ZKFingerprint V13 standard / V10 optional',
    connection:'AC_OR_TA_PUSH',
    templateTransfer:'REQUIRES_FIRMWARE_AND_SDK_VERIFICATION'
  };
  if(code==='SENSEFACE3A')return{
    key:'SENSEFACE_3A',name:'ZKTeco SenseFace 3A',fingerprint:true,face:true,
    fingerprintAlgorithm:'ZKFingerprint V13 standard / V10 optional',
    connection:'AC_OR_TA_PUSH',
    templateTransfer:'REQUIRES_FIRMWARE_AND_SDK_VERIFICATION'
  };
  return{
    key:'UNKNOWN',name:clean(model)||'Неизвестная модель',fingerprint:false,face:false,
    fingerprintAlgorithm:'Не установлено',connection:'VERIFY_MODEL_AND_FIRMWARE',
    templateTransfer:'NOT_SUPPORTED_UNTIL_VERIFIED'
  };
}
export function plannedDeviceRoster(devices,employees,scope){
  const directory=(scope?.selectedRestaurants||[]);
  const selected=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  const network=scope?.isChain===true;
  const active=(employees||[]).filter(e=>!Number(e?.is_deleted??e?.deleted)&&!clean(e?.fire_date??e?.fireDate));
  const restricted=Boolean(scope?.membershipRestricted)||
    Boolean(network&&Array.isArray(scope?.allowedDepartmentIds)&&selected.size<scope.allowedDepartmentIds.length);
  const knownDepartments=new Set(directory.map(r=>norm(r?.code)).filter(Boolean));
  return(devices||[]).map(d=>{
    const deviceId=clean(d?.device_id??d?.id),restaurantId=clean(d?.restaurant_id??d?.restaurantId);
    const restaurant=network?directory.find(r=>clean(r?.id)===restaurantId&&selected.has(restaurantId)):null;
    const targetCode=norm(restaurant?.code);
    const eligible=(!network||Boolean(targetCode))?active.filter(e=>{
      if(!network)return true;
      const codes=[...(e?.departmentCodes||[]),e?.department_code??e?.departmentCode].map(norm);
      // CHAIN roaming: centrally manage the same enrolled person on every
      // authorized device. Only real staff with a known RMS assignment qualify.
      // A department-only manager cannot obtain the full network directory.
      return restricted?codes.includes(targetCode):codes.some(code=>knownDepartments.has(code));
    }):[];
    const model=zktecoModelProfile(d?.device_model??d?.model);
    const codeCounts=new Map();
    for(const e of active){
      const code=clean(e?.employee_code??e?.code);
      if(code)codeCounts.set(code,(codeCounts.get(code)||0)+1);
    }
    const people=eligible.map(e=>{
      const code=clean(e?.employee_code??e?.code);
      // A device PIN is not assigned until network-wide numeric-ID reservation
      // and collision checks have been implemented. Numeric tab numbers are
      // possible candidates, not guaranteed ZKTeco identifiers.
      const suggestedId=/^[1-9][0-9]{0,8}$/.test(code)&&codeCounts.get(code)===1?code:null;
      return{id:clean(e?.iiko_employee_id??e?.id),
        name:clean(e?.display_name??e?.name),
        employeeCode:code,
        suggestedId,idStatus:suggestedId?'CANDIDATE_ONLY':'NUMERIC_ID_REQUIRED'};
    });
    return{
      deviceId,name:clean(d?.name),restaurantId,restaurantName:clean(restaurant?.name),
      model,mode:clean(d?.connection_mode??d?.connectionMode),
      online:d?.admsOnline===true,eligibleCount:people.length,
      preview:people.slice(0,12),additionalCount:Math.max(0,people.length-12),
      rosterMode:network?'CHAIN_ALL_DEVICES':'RMS_ONLY',
      rosterStatus:network&&!restaurant?'RESTAURANT_NOT_IN_SCOPE':restricted?'MEMBER_VIEW_ONLY':'PREVIEW_ONLY',
      provisioningEnabled:false,biometricSyncEnabled:false
    };
  });
}
