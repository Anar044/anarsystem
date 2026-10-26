import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "../../iiko/_lib/user-state.js";
import { resolveAccessForUser, listUserWorkspaces } from "../../access/_lib/access-control.js";
import { restaurantDirectory, allowedDepartmentIds } from "../../iiko/_lib/restaurant-scope.js";
import { bindWorkspaceIikoBroker } from "../../iiko/_lib/iiko-client.js";

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

// The private broker never exposes credentials in its error code. When
// Owner mobile has opted into the shared session, do not hide actionable
// configuration failures behind the generic 502 banner. Never echo the
// raw upstream error, which may contain private iiko data.
export function ownerBrokerFailure(source) {
  const text=String(source?.message ?? source ?? "");
  const match=text.match(/\\bSH central iiko broker\\s+([A-Z][A-Z0-9_]+)(?:\\s|\\(|$)/i);
  const code=match?.[1]?.toUpperCase();
  const messages={
    FORBIDDEN:"Подключение приложения к общему серверу не подтверждено. Администратору нужно проверить совпадение секретов.",
    CONFIG_MISSING:"Не завершена настройка общего сервера подключений. Проверьте его параметры.",
    ENCRYPTION_CONFIG_INVALID:"Общий сервер подключений имеет неверный ключ шифрования.",
    TARGET_DENIED:"Сохранённый адрес сервера учёта не разрешён в общем подключении.",
    BAD_REQUEST:"Общий сервер отклонил формат служебного запроса.",
    UNAVAILABLE:"Не удалось связаться с общим сервером подключений.",
    BROKER_BUSY:"Общий сервер подключений перегружен. Повторите запрос.",
    BROKER_DRAINING:"Общий сервер подключений временно завершает активные операции.",
    BROKER_ERROR:"Общий сервер подключений не смог обработать запрос.",
    AUTH_UNCERTAIN:"Статус авторизации сервера учёта не подтверждён. Повторный вход автоматически заблокирован.",
    AUTH_COOLDOWN:"Повторный вход в сервер учёта временно ограничен для защиты лицензий.",
    AUTH_FAILED:"Не удалось авторизоваться в сервере учёта через общее подключение."
  };
  if(!code || !Object.prototype.hasOwnProperty.call(messages,code))return null;
  return new MobileError("IIKO_BROKER_"+code,messages[code],502);
}

export function errorResponse(error) {
  const mapped=ownerBrokerFailure(error);
  if(mapped)error=mapped;
  const status = Number(error?.status) || 500;
  return response({
    success: false,
    code: error?.code || (status >= 500 ? "MOBILE_SERVER_ERROR" : "ACCESS_DENIED"),
    // Explicit MobileError messages are authored and safe to display, even on
    // a 502. Never show raw upstream secrets, URLs, HTML or stack traces.
    message: error instanceof MobileError ? error.message :
      status >= 500 ? "Не удалось загрузить данные Smart Horeca." :
      String(error?.message || "Неизвестная ошибка.")
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

// Explain a failure without revealing any other user's memberships or
// identifying other tenants. This status is derived only from this user's
// authenticated memberships in the currently bound D1 environment.
export function mobileWorkspaceAccessStatus(workspaces, visible) {
  if (visible.length) return "READY";
  if (!workspaces.length) return "NO_MEMBERSHIPS_IN_THIS_ENVIRONMENT";
  if (!workspaces.some(w =>
    clean(w.memberStatus).toUpperCase() === "ACTIVE" &&
    clean(w.status).toUpperCase() === "ACTIVE")) {
    return "NO_ACTIVE_MEMBERSHIPS";
  }
  return "OWNER_OR_SYSADMIN_ROLE_REQUIRED";
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
  const visible = visibleMobileOwnerWorkspaces(workspaces, admins);
  return {
    user: { id: auth.user.id, email: auth.user.email || "" },
    workspaces: visible,
    accessStatus: mobileWorkspaceAccessStatus(workspaces, visible)
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
    connection: connectionRequired
      ? bindWorkspaceIikoBroker(privateConnection(state),env,access) : null
  };
}


/** Internal-only delegation metadata: never read workspace or iiko host
 * from an untrusted JSON body, URL, or mobile header. mobileContext verified
 * active workspace membership, role, restaurant scope and saved credentials. */
export function ownerBrokerContext(ctx, env) {
  const id = clean(ctx?.access?.workspace?.id);
  if (!ctx?.access?.allowed || !id || !ctx?.connection) {
    throw new MobileError("OWNER_BROKER_SCOPE_UNVERIFIED",
      "Не удалось подтвердить подключение организации.", 403);
  }
  return {
    env,
    data:{
      shBrokerTenantId:"workspace:"+id,
      shBrokerVerifiedConnection:ctx.connection
    }
  };
}
