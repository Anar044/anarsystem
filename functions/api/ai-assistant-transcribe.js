import { getUser } from "./iiko/_lib/user-state.js";

const DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe";
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

function clean(value) { return String(value ?? "").trim(); }
function cors(contentType = "application/json; charset=utf-8") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Cache-Control": "no-store",
    "Content-Type": contentType
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Требуется авторизация." }, 401);

    const apiKey = clean(env.OPENAI_API_KEY);
    if (!apiKey) return json({ success: false, message: "OPENAI_API_KEY не настроен." }, 503);

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return json({ success: false, message: "Аудиозапись не получена." }, 400);
    }
    if (!audio.size) return json({ success: false, message: "Аудиозапись пустая." }, 400);
    if (audio.size > MAX_AUDIO_BYTES) {
      return json({ success: false, message: "Голосовое сообщение слишком большое. Максимум 15 МБ." }, 413);
    }

    const upstream = new FormData();
    upstream.set("file", audio, audio.name || "voice.webm");
    upstream.set("model", clean(env.OPENAI_TRANSCRIBE_MODEL) || DEFAULT_TRANSCRIBE_MODEL);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `OpenAI transcription HTTP ${response.status}`;
      return json({ success: false, message }, 502);
    }

    const text = clean(payload?.text);
    if (!text) return json({ success: false, message: "Речь не распознана. Попробуйте сказать ещё раз." }, 422);

    return json({
      success: true,
      text,
      model: clean(env.OPENAI_TRANSCRIBE_MODEL) || DEFAULT_TRANSCRIBE_MODEL
    });
  } catch (error) {
    console.error("[AI ASSISTANT TRANSCRIBE]", error);
    return json({ success: false, message: error?.message || "Ошибка распознавания речи." }, 500);
  }
}
