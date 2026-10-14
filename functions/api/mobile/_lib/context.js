import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "../../iiko/_lib/user-state.js";
import { resolveAccessForUser, listUserWorkspaces } from "../../access/_lib/access-control.js";
import { restaurantDirectory, allowedDepartmentIds } from "../../iiko/_lib/restaurant-scope.js";

const clean = value => String(value ?? "").trim();
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];

export class MobileError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Authorization, X-SH-Workspace-Id, X-SH-Department-Ids"
    }
  });
}

export function errorResponse(error) {
  const status = Number(error?.status) || 500;
  return response({
    success: false,
    code: error?.code || (status >= 500 ? "MOBILE_SERVER_ERROR" : "ACCESS_DENIED"),
    message: status >= 500 ? "Не удалось загрузить данные Smart Horeca." : error.message
  }, status);
}

export async function authenticatedUser(request, env) {
  // Mobile endpoints require explicit bearer tokens. Never accept a web cookie
  // as the only proof of authentication.
  if (!/^Bearer\s+\S+$/i.test(request.headers.get("Authorization") || "")) {
    throw new MobileError("TOKEN_REQUIRED", "Требуется вход в аккаунт.", 401);
  }
  const auth = await getUser(request, env);
  if (!auth?.user) throw new MobileError("UNAUTHENTICATED", "Сессия истекла.", 401);
  if (!env.DB) throw new MobileError("DATABASE_UNAVAILABLE", "База данных недоступна.", 503);
  return auth;
}

// Platform-managed organizations use synthetic owner_user_id='platform-org:<id>'.
// Their actual SYSADMIN is a verified ADMIN-role member, not the D1 owner.
// Do not confuse an administrator of a workspace with a platform administrator:
// neither email nor PLATFORM_ADMIN_USER_IDS are accepted as membership evidence.
export async function hasAssignedOrganizationAdminRole(db, memberId, ownerUserId) {
  const member = clean(memberId), owner = clean(ownerUserId);
  if (!member || !owner) return false;
  const result = await db.prepare(`SELECT 1 AS authorized
    FROM sh_access_member_roles mr
    JOIN sh_access_roles role
      ON role.id=mr.role_id AND role.owner_user_id=mr.owner_user_id
    WHERE mr.member_id=?1 AND mr.owner_user_id=?2
      AND role.code='ADMIN' AND role.is_system=1
    LIMIT 1`).bind(member, owner).first();
  return result?.authorized === 1 || result?.authorized === true;
}

export function visibleMobileOwnerWorkspaces(workspaces, authorizedAdmins = new Set()) {
  return (workspaces || [])
    .filter(w => w && typeof w === "object"
      && (w.isOwner === true || authorizedAdmins.has(clean(w.id)))
      && clean(w.memberStatus).toUpperCase() === "ACTIVE"
      && clean(w.status).toUpperCase() === "ACTIVE"
      && Boolean(clean(w.id)))
    .map(w => ({
      id: clean(w.id),
      name: clean(w.name || w.title || "Рабочее пространство"),
      status: "ACTIVE",
      isOwner: w.isOwner === true,
      mobileEligible: true
    }));
}

export async function listMobileWorkspaces(request, env) {
  const auth = await authenticatedUser(request, env);
  const workspaces = await listUserWorkspaces(env.DB, auth.user);
  const admins = new Set();
  for (const w of workspaces) {
    if (w.isOwner === true) continue;
    if (clean(w.memberStatus).toUpperCase() !== "ACTIVE"
        || clean(w.status).toUpperCase() !== "ACTIVE") continue;
    if (await hasAssignedOrganizationAdminRole(env.DB, w.memberId, w.ownerUserId)) {
      admins.add(clean(w.id));
    }
  }
  return {
    user: { id: auth.user.id, email: auth.user.email || "" },
    workspaces: visibleMobileOwnerWorkspaces(workspaces, admins)
  };
}

export async function mobileContext(request, env, { connectionRequired = false } = {}) {
  const auth = await authenticatedUser(request, env);
  const workspaceId = clean(request.headers.get("X-SH-Workspace-Id"));
  if (!workspaceId) {
    throw new MobileError("WORKSPACE_REQUIRED", "Выберите рабочее пространство.", 409);
  }

  const access = await resolveAccessForUser(env.DB, auth.user, {
    claimInvite: false,
    workspaceId,
    request: null
  });
  if (!access?.allowed || clean(access.workspace?.id) !== workspaceId) {
    throw new MobileError("WORKSPACE_FORBIDDEN", "Нет доступа к выбранной организации.", 403);
  }
  // Approved owner/SYSADMIN only. Platform organizations use synthetic D1
  // owners; their actual designated SYSADMIN is assigned the system ADMIN role.
  // Require explicit server-side membership proof; never infer from email or
  // browser role labels. Membership & workspace status were verified above.
  const mobileEligible = access.isOwner === true ||
    await hasAssignedOrganizationAdminRole(env.DB, access.memberId, access.ownerUserId);
  if (!mobileEligible) {
    throw new MobileError("OWNER_ONLY", "Для этого аккаунта не назначен доступ владельца или SYSADMIN организации.", 403);
  }

  const stored = await loadPrivateIikoState(
    env.DB, access.storageUserId || access.ownerUserId || auth.user.id, env
  );
  const state = stored?.state || {};
  const availableIds = unique(allowedDepartmentIds(state));
  const requested = unique((request.headers.get("X-SH-Department-Ids") || "")
    .split(","));
  if (requested.some(id => !availableIds.includes(id))) {
    throw new MobileError("RESTAURANT_FORBIDDEN", "Выбран недоступный ресторан.", 403);
  }
  if (!availableIds.length) {
    throw new MobileError("RESTAURANTS_UNAVAILABLE", "Рестораны пока не настроены.", 409);
  }
  const selectedIds = requested.length ? requested : availableIds;
  const directory = restaurantDirectory(state);
  const restaurants = directory.filter(r => availableIds.includes(clean(r.id)))
    .map(r => ({ id: clean(r.id), name: clean(r.name || r.id) }));
  const connectionReady = hasPrivateConnection(state);
  if (connectionRequired && !connectionReady) {
    throw new MobileError("SH_CONNECTION_MISSING", "Smart Horeca Server не подключён.", 503);
  }
  return {
    auth, access, state, stored,
    selectedIds, availableIds, restaurants, connectionReady,
    connection: connectionRequired ? privateConnection(state) : null
  };
}
