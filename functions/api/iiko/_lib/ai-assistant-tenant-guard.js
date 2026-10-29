// Server-only guard against a user prompt selecting a different organization or
// restaurant. The real authorization boundary remains the server-resolved
// workspace and enforced department filters in the data tools.
const clean = v => String(v ?? "").trim();
function normalized(value) {
  const translit = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",
    л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",
    ц:"ts",ч:"ch",ш:"sh",щ:"sh",ы:"y",э:"e",ю:"yu",я:"ya",ь:"",ъ:"",
    ə:"e",ı:"i",ö:"o",ü:"u",ğ:"g",ç:"c",ş:"s"
  };
  return clean(value).toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .split("").map(char=>translit[char] ?? char).join("")
    .replace(/\boffice\b|\bofice\b|\bofis\b/g,"ofis")
    .replace(/[^a-z0-9]+/g," ").trim();
}
const words = value => normalized(value).split(" ").filter(Boolean);
const generic = new Set(["chain","set","seti","network","organization","organizasiya","organizatsiya",
  "office","ofis","restaurant","restoran","company","kompaniya","the","and","smart","horeca"]);
function mentionsName(message, name) {
  const nameWords=words(name),textWords=words(message);
  if(!nameWords.length||!textWords.length)return false;
  const textSet=new Set(textWords);
  const distinct=nameWords.filter(x=>x.length>=2&&!generic.has(x));
  if(distinct.length>=2) {
    // Require at least two distinctive words, close together. This supports
    // "Test ofis" for "Test Office Chain" without matching "test" alone.
    const matched=distinct.filter(x=>textSet.has(x));
    if(matched.length<2)return false;
    const positions=matched.map(x=>textWords.indexOf(x)).filter(x=>x>=0);
    return Math.max(...positions)-Math.min(...positions)<=7;
  }
  if(distinct.length===1&&distinct[0].length>=6&&textSet.has(distinct[0])) {
    // A single distinctive brand must be an exact whole-word match.
    return true;
  }
  return false;
}
function explicitOtherTenant(message) {
  const line=normalized(message);
  // Literal references to another network, organization or restaurant should
  // never be interpreted as a request for the currently selected business.
  return /\b(drug\w*|drq\w*|other|another|different|chuzh\w*|sosedn\w*|inoy|inaya)\b(?:\s+\w+){0,4}\s+\b(set\w*|network|chain|organiz\w*|company|kompan\w*|restoran\w*|restaurant\w*)\b/.test(line);
}
export function checkAssistantTenantTarget(message, access, scope) {
  if (!access?.allowed || !clean(access?.workspace?.id) || !clean(access?.storageUserId)) {
    return {allowed:false,code:"ASSISTANT_TENANT_UNVERIFIED"};
  }
  if(explicitOtherTenant(message)) return {allowed:false,code:"ASSISTANT_OTHER_TENANT_REQUEST"};
  const activeWorkspaceId=clean(access.workspace.id);
  for (const workspace of access.workspaces || []) {
    if(clean(workspace?.id)===activeWorkspaceId)continue;
    if(mentionsName(message,workspace?.name))return {allowed:false,code:"ASSISTANT_OTHER_TENANT_REQUEST"};
  }
  const selectedIds=new Set((scope?.selectedDepartmentIds||[]).map(clean).filter(Boolean));
  if(scope?.isChain){
    for (const restaurant of scope.allRestaurants || []) {
      if(selectedIds.has(clean(restaurant?.id)))continue;
      if(mentionsName(message,restaurant?.name)){
        return {allowed:false,code:"ASSISTANT_OTHER_RESTAURANT_REQUEST"};
      }
    }
  }
  return {allowed:true};
}
