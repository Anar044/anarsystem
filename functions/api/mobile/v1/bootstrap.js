import { mobileContext, response, errorResponse } from "../_lib/context.js";

export async function onRequestGet({ request, env }) {
  try {
    const ctx = await mobileContext(request, env);
    // Never return private connection state, login, IP, upstream token
    // or any other SH/iiko credentials to the mobile device.
    return response({
      success: true,
      user: {
        id: ctx.auth.user.id,
        email: ctx.auth.user.email || "",
        displayName: ctx.access.displayName || "",
        role: "Owner"
      },
      workspace: {
        id: ctx.access.workspace.id,
        name: ctx.access.workspace.name || "Smart Horeca"
      },
      restaurants: ctx.restaurants,
      selectedDepartmentIds: ctx.selectedIds,
      connectionReady: ctx.connectionReady,
      stateUpdatedAt: ctx.stored.updatedAt || null,
      permissions: {
        dashboard: true,
        cash: true,
        reports: true,
        inventory: true,
        assistant: true
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
