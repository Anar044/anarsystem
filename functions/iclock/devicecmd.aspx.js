import { handleDeviceCmd } from "../api/hr/_lib/zkteco-adms.js";
export async function onRequestGet(context){return handleDeviceCmd(context)}
export async function onRequestPost(context){return handleDeviceCmd(context)}
