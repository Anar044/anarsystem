import { handlePing } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handlePing(context)}
export async function onRequestPost(context){return handlePing(context)}
