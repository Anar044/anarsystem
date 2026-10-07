import { handleRegistry } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handleRegistry(context)}
export async function onRequestPost(context){return handleRegistry(context)}
