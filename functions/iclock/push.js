import { handlePush } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handlePush(context)}
export async function onRequestPost(context){return handlePush(context)}
