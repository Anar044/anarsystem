import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/mpeg",
  "audio/wav", "audio/webm", "audio/ogg"
]);

function clean(value) { return String(value ?? "").trim(); }

// Owner-only, tenant-checked transcription. No iiko credentials, /auth,
// sessions, departments, or server URLs are ever sent to OpenAI.
export async function onRequestPost({request, env}) {
  try {
    await mobileContext(request, env);
    const language = clean(request.headers.get("X-SH-Voice-Language")).toLowerCase();
    if (!["az", "ru", "en"].includes(language)) {
      throw new MobileError("VOICE_LANGUAGE_INVALID", "Неверный язык записи.", 400);
    }
    const type = clean(request.headers.get("content-type")).toLowerCase();
    if (!type.startsWith("multipart/form-data;")) {
      throw new MobileError("VOICE_FORMAT_INVALID", "Требуется аудиозапись.", 415);
    }
    const length=Number(request.headers.get("content-length"));
    if(Number.isFinite(length) && length>MAX_AUDIO_BYTES+4096) {
      throw new MobileError("VOICE_TOO_LARGE","Голосовая запись слишком большая (максимум 15 МБ).",413);
    }
    const form=await request.formData();
    const file=form.get("audio");
    if (!file || typeof file.size!=="number" || typeof file.arrayBuffer!=="function" || file.size<1) {
      throw new MobileError("VOICE_EMPTY","Голосовая запись не получена.",400);
    }
    if (file.size>MAX_AUDIO_BYTES) {
      throw new MobileError("VOICE_TOO_LARGE","Голосовая запись слишком большая (максимум 15 МБ).",413);
    }
    const mime=clean(file.type).toLowerCase();
    if(mime && !ALLOWED_MIME.has(mime)) {
      throw new MobileError("VOICE_FORMAT_INVALID","Неподдерживаемый формат аудио.",415);
    }
    const apiKey=clean(env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new MobileError("VOICE_SERVICE_NOT_CONFIGURED",
        "Распознавание голоса пока не настроено на сервере Smart Horeca.",503);
    }
    const payload=new FormData();
    payload.set("model","gpt-transcribe");
    payload.set("file",file,"owner-question.m4a");
    // gpt-transcribe works in the original spoken language. A context prompt
    // improves Azerbaijani Latin transcription without forcing a translation.
    const prompts={
      az:"Transcribe natural spoken Azerbaijani in Azerbaijani Latin script. Preserve original wording. The speaker asks about restaurant sales, kassalar, hesabatlar, anbar qalıqları, gəlir, endirim, maya dəyəri, Smart Horeca and iiko. Do not translate.",
      ru:"Transcribe spoken Russian exactly. Restaurant analytics, sales, inventory, iiko and Smart Horeca.",
      en:"Transcribe spoken English exactly. Restaurant analytics, sales, inventory, iiko and Smart Horeca."
    };
    payload.set("prompt",prompts[language]);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    let upstream;
    try {
      upstream=await fetch("https://api.openai.com/v1/audio/transcriptions",{
        method:"POST",
        headers:{"Authorization":"Bearer "+apiKey},
        body:payload,signal:controller.signal
      });
    } finally {clearTimeout(timer)}
    const body=await upstream.json().catch(()=>null);
    if(!upstream.ok) {
      throw new MobileError("VOICE_TRANSCRIPTION_FAILED",
        "Не удалось распознать голос. Повторите запись.",502);
    }
    const transcript=clean(body?.text);
    if(!transcript) {
      throw new MobileError("VOICE_NOT_RECOGNIZED",
        "Речь не распознана. Попробуйте произнести вопрос ещё раз.",422);
    }
    return response({success:true,text:transcript.slice(0,4000),language});
  }catch(error){return errorResponse(error)}
}
