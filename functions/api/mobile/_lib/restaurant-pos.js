// Informational POS visibility, derived only from the user's already-scoped
// CHAIN configuration snapshot. This NEVER grants or removes department access,
// and never relies on same-day sales or cash shifts to mark a restaurant active.
const clean = value => String(value ?? "").trim();
const rows = value => Array.isArray(value) ? value : null;

export function restaurantPosStatuses(state, authorizedRestaurants) {
  const identity = state?.identity || {};
  const connection = state?.connection || {};
  const sources = [identity, connection];
  const registered = new Set((authorizedRestaurants || [])
    .map(r => clean(r?.id)).filter(Boolean));
  const counts = new Map([...registered].map(id => [id, new Set()]));
  const observed = new Set();

  // A complete group-to-POS mapping may be present in either saved CHAIN
  // structure. Never count a standalone group as an actual cash register.
  for (const source of sources) {
    const groups = rows(source?.groups);
    const terminals = rows(source?.pointsOfSale);
    if (!groups || !terminals || !groups.length) continue;
    const groupDepartments = new Map();
    for (const g of groups) {
      const gid = clean(g?.id), did = clean(g?.departmentId);
      if (gid && registered.has(did)) {
        groupDepartments.set(gid, did);
        observed.add(did);
      }
    }
    for (const terminal of terminals) {
      const id = clean(terminal?.id);
      const department = groupDepartments.get(clean(terminal?.groupId));
      if (id && department) counts.get(department).add(id);
    }
  }

  const result = {};
  for (const id of registered) {
    const count = counts.get(id).size;
    result[id] = {
      // 'without_pos' means absent from a saved topology snapshot, not
      // disabled in the SH Server; the owner can show it at any time.
      posStatus: count > 0 ? "with_pos" :
        observed.has(id) ? "without_pos" : "unknown",
      posCount: count
    };
  }
  return result;
}
