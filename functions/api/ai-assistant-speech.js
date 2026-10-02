import { getUser } from "./iiko/_lib/user-state.js";

const DEFAULT_SPEECH_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "marin";
const MAX_TEXT = 4000;

function clean(value) { return String(value ?? "").trim(); }
function headers(contentType = "application/json; charset=utf-8") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Cache-Control": "no-store",
    "Content-Type": contentType
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers() });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: headers() });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Требуется авторизация." }, 401);

    const apiKey = clean(env.OPENAI_API_KEY);
    if (!apiKey) return json({ success: false, message: "OPENAI_API_KEY не настроен." }, 503);

    const body = await request.json().catch(() => ({}));
    const text = clean(body.text);
    if (!text) return json({ success: false, message: "Нет текста для озвучивания." }, 400);
    if (text.length > MAX_TEXT) {
      return json({ success: false, message: "Ответ слишком длинный для озвучивания целиком." }, 400);
    }

    const model = clean(env.OPENAI_SPEECH_MODEL) || DEFAULT_SPEECH_MODEL;
    const voice = clean(body.voice || env.OPENAI_SPEECH_VOICE) || DEFAULT_VOICE;

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: "mp3",
        instructions: "Говори естественно и ясно на том же языке, на котором написан текст. Не меняй смысл и числа."
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error?.message || payload?.message || `OpenAI speech HTTP ${response.status}`;
      return json({ success: false, message }, 502);
    }

    return new Response(response.body, {
      status: 200,
      headers: headers("audio/mpeg")
    });
  } catch (error) {
    console.error("[AI ASSISTANT SPEECH]", error);
    return json({ success: false, message: error?.message || "Ошибка синтеза речи." }, 500);
  }
}
