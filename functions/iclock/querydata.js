import { handleQueryData } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handleQueryData(context)}
export async function onRequestPost(context){return handleQueryData(context)}
