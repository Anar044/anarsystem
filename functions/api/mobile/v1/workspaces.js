import { listMobileWorkspaces, response, errorResponse } from "../_lib/context.js";

export async function onRequestGet({ request, env }) {
  try {
    return response({ success: true, ...await listMobileWorkspaces(request, env) });
  } catch (error) {
    return errorResponse(error);
  }
}
