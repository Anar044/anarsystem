import { handleCdata } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handleCdata(context)}
export async function onRequestPost(context){return handleCdata(context)}
