import {
  getUser,
  loadPrivateIikoState,
  privateConnection,
  hasPrivateConnection
} from "./iiko/_lib/user-state.js";
import { resolveRestaurantScope } from "./iiko/_lib/restaurant-scope.js";
import {
  assistantToolDefinitions,
  executeAssistantTool
} from "./iiko/_lib/ai-assistant-tools.js";

const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_HISTORY_MESSAGES = 16;
const MAX_TOOL_ROUNDS = 6;


const ASSISTANT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["text", "report", "chart", "report_with_chart"] },
    text: { type: "string" },
    report: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            periodLabel: { type: "string" },
            kpis: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" }
                },
                required: ["label", "value"],
                additionalProperties: false
              }
            },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  align: { type: "string", enum: ["left", "right", "center"] }
                },
                required: ["label", "align"],
                additionalProperties: false
              }
            },
            rows: {
              type: "array",
              items: {
                type: "array",
                items: { type: "string" }
              }
            },
            totals: {
              type: "array",
              items: { type: "string" }
            },
            notes: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["title", "subtitle", "periodLabel", "kpis", "columns", "rows", "totals", "notes"],
          additionalProperties: false
        }
      ]
    },
    chart: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["bar", "horizontal_bar", "line", "pie"] },
            title: { type: "string" },
            subtitle: { type: "string" },
            xLabel: { type: "string" },
            yLabel: { type: "string" },
            series: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  data: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        value: { type: "number" }
                      },
                      required: ["label", "value"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["name", "data"],
                additionalProperties: false
              }
            },
            notes: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["type", "title", "subtitle", "xLabel", "yLabel", "series", "notes"],
          additionalProperties: false
        }
      ]
    }
  },
  required: ["kind", "text", "report", "chart"],
  additionalProperties: false
};

function parseAssistantPayload(text) {
  const raw = clean(text);
  if (!raw) return { kind: "text", text: "", report: null, chart: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid payload");
    const hasReport = !!parsed.report;
    const hasChart = !!parsed.chart;
    let kind = "text";
    if (hasReport && hasChart) kind = "report_with_chart";
    else if (hasReport) kind = "report";
    else if (hasChart) kind = "chart";
    return {
      kind,
      text: clean(parsed.text),
      report: hasReport ? parsed.report : null,
      chart: hasChart ? parsed.chart : null
    };
  } catch (_) {
    return { kind: "text", text: raw, report: null, chart: null };
  }
}


function clean(value) { return String(value ?? "").trim(); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }
  });
}
function id() {
  try { return crypto.randomUUID(); } catch (_) {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function nowIso() { return new Date().toISOString(); }

async function ensureTables(db) {
  if (!db) throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_assistant_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT 'Новый чат',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_assistant_conversations_user
      ON ai_assistant_conversations(user_id, updated_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_assistant_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_conversation
      ON ai_assistant_messages(conversation_id, created_at ASC)`)
  ]);
  try{await db.prepare("ALTER TABLE ai_assistant_conversations ADD COLUMN scope_key TEXT NOT NULL DEFAULT ''").run()}catch(_){}
  try{await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_assistant_conversations_user_scope ON ai_assistant_conversations(user_id, scope_key, updated_at DESC)").run()}catch(_){}
}
function conversationScopeKey(iiko){
  const scope=iiko?.scope;
  if(!scope?.isChain)return "";
  const ids=[...new Set((scope.selectedDepartmentIds||[]).map(String).filter(Boolean))].sort();
  return `CHAIN:${ids.join(",")}`;
}
async function conversationById(db, userId, conversationId, scopeKey="") {
  return db.prepare(`SELECT id,title,created_at,updated_at
    FROM ai_assistant_conversations
    WHERE id=?1 AND user_id=?2 AND scope_key=?3 LIMIT 1`)
    .bind(conversationId, userId, scopeKey).first();
}
async function createConversation(db, userId, scopeKey="", title = "Новый чат") {
  const conversationId = id();
  const now = nowIso();
  await db.prepare(`INSERT INTO ai_assistant_conversations(id,user_id,scope_key,title,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?5)`)
    .bind(conversationId, userId, scopeKey, clean(title).slice(0, 100) || "Новый чат", now).run();
  return { id: conversationId, title: clean(title).slice(0, 100) || "Новый чат", created_at: now, updated_at: now };
}
async function touchConversation(db, userId, conversationId, title) {
  const now = nowIso();
  if (title) {
    await db.prepare(`UPDATE ai_assistant_conversations SET title=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`)
      .bind(clean(title).slice(0, 100), now, conversationId, userId).run();
  } else {
    await db.prepare(`UPDATE ai_assistant_conversations SET updated_at=?1 WHERE id=?2 AND user_id=?3`)
      .bind(now, conversationId, userId).run();
  }
}
async function saveMessage(db, userId, conversationId, role, content, meta = null) {
  const messageId = id();
  await db.prepare(`INSERT INTO ai_assistant_messages(id,conversation_id,user_id,role,content,meta_json,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7)`)
    .bind(
      messageId,
      conversationId,
      userId,
      role,
      String(content ?? ""),
      meta ? JSON.stringify(meta) : null,
      nowIso()
    ).run();
  return messageId;
}
async function recentMessages(db, userId, conversationId, limit = MAX_HISTORY_MESSAGES) {
  const rows = await db.prepare(`SELECT id,role,content,meta_json,created_at
    FROM ai_assistant_messages
    WHERE conversation_id=?1 AND user_id=?2
    ORDER BY created_at DESC LIMIT ?3`)
    .bind(conversationId, userId, Math.max(1, Math.min(30, Number(limit) || MAX_HISTORY_MESSAGES)))
    .all();
  return (rows.results || []).reverse().map(row => ({
    id: row.id,
    role: row.role,
    content: row.content,
    meta: safeJson(row.meta_json, null),
    createdAt: row.created_at
  }));
}
async function listConversations(db, userId, scopeKey="") {
  const rows = await db.prepare(`SELECT id,title,created_at,updated_at
    FROM ai_assistant_conversations
    WHERE user_id=?1 AND scope_key=?2 ORDER BY updated_at DESC LIMIT 30`)
    .bind(userId,scopeKey).all();
  return rows.results || [];
}
async function resolveIiko(env, userId, request=null, requestedIds=null) {
  const stored = await loadPrivateIikoState(env.DB, userId, env);
  if (!stored?.found || !hasPrivateConnection(stored.state)) {
    return { connected: false, connection: null, state:null, scope:null };
  }
  const scope=resolveRestaurantScope({state:stored.state,request,strict:true});
  const bodyIds=[...new Set((Array.isArray(requestedIds)?requestedIds:[]).map(String).filter(Boolean))];
  if(bodyIds.length){
    const selected=new Set(scope.selectedDepartmentIds||[]);
    const outside=bodyIds.filter(id=>!selected.has(id));
    if(outside.length){
      const error=new Error("AI запрос содержит ресторан вне текущего выбора Smart Horeca.");
      error.status=403;
      error.code="CHAIN_SCOPE_SELECTION_FORBIDDEN";
      throw error;
    }
  }
  return { connected: true, connection: privateConnection(stored.state), state:stored.state, scope };
}
function outputText(response) {
  if (clean(response?.output_text)) return clean(response.output_text);
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if ((content?.type === "output_text" || content?.type === "text") && content.text) {
        parts.push(content.text);
      }
    }
  }
  return clean(parts.join("\n"));
}
function functionCalls(response) {
  return (response?.output || []).filter(item => item?.type === "function_call" && item?.name && item?.call_id);
}
async function openAiResponse(env, payload) {
  const apiKey = clean(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY не настроен.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `OpenAI HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
function instructions(model, connected) {
  const today = new Date().toISOString().slice(0, 10);
  return `Ты — AI-аналитик SmartHoreca для управления рестораном.
Сегодня: ${today}.
Отвечай на языке пользователя; по умолчанию на русском.

Твоя задача — не только OLAP. Используй любые доступные инструменты SmartHoreca, подходящие под вопрос:
- приходные накладные и закупочные цены;
- поставщики;
- номенклатура;
- OLAP-продажи;
- другие источники по мере появления инструментов.

Правила:
1. Никогда не придумывай цифры, поставщиков, цены, товары или результаты. Для вопросов о данных ресторана обязательно используй инструмент.
2. Если нужный источник пока не подключён как AI-инструмент, прямо скажи это и укажи, какой раздел SmartHoreca доступен пользователю вручную.
3. При неоднозначном названии товара сначала найди похожие позиции и учитывай несколько подходящих товаров, если запрос пользователя подразумевает категорию (например "помидоры").
4. Для закупочных цен показывай период, поставщика, товар и динамику цены. Не называй "текущей ценой" цену, если это лишь последняя цена в найденной накладной.
5. Для сравнений объясняй, на каких данных основан вывод.
6. Не выполняй запись/изменение данных в iiko. Все инструменты этой версии только читают данные.
7. Для обычного вопроса верни kind="text", краткий текст в text, report=null и chart=null.
8. Если пользователь просит обычный табличный отчёт, сводку или таблицу — верни kind="report", заполни report и поставь chart=null.
9. Если пользователь прямо просит "график", "диаграмму", "визуально", "покажи динамику графиком" — верни kind="chart", report=null и заполни chart.
10. Если пользователь просит одновременно отчёт/таблицу и график — верни kind="report_with_chart" и заполни и report, и chart.
11. Для сравнений категорий используй bar или horizontal_bar. Для динамики во времени используй line. Для долей/структуры используй pie только когда доли действительно уместны.
12. В chart.series.data значение value всегда должно быть числом без валютного символа и без форматирования тысяч. label — человекочитаемая подпись.
13. Не придумывай точки графика: все значения chart должны прямо следовать из данных инструментов.
14. В report.columns укажи понятные человеку названия колонок и align: числовые значения обычно right, текст left.
15. В report.rows каждая строка должна содержать столько строковых значений, сколько columns. Не вставляй Markdown в cells.
16. report.totals используй для итоговой строки; если итоги неуместны — верни пустой массив.
17. report.kpis используй только для ключевых показателей, которые действительно следуют из данных инструмента.
18. report.notes и chart.notes — короткие пояснения об источнике, периоде, методике или ограничениях.
19. Никогда не дублируй большую таблицу в text: text должен быть коротким вводным/итоговым комментарием.
20. Если результат большой, в report.rows оставь наиболее полезные строки, а ограничение объясни в notes.
21. Не раскрывай технические пароли, токены или внутренние секреты.
22. Подключение к iiko сейчас: ${connected ? "есть" : "нет"}.

Модель: ${model}.`;
}
function inputFromHistory(history) {
  return history.map(message => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  }));
}
function safeToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(String(raw || "{}")); } catch { return {}; }
}
function compactToolTrace(call, result) {
  const trace = { name: call.name, ok: !result?.error };
  if (call.name === "search_products") trace.count = result?.count ?? null;
  if (call.name === "analyze_purchase_prices") {
    trace.matchedPurchaseRows = result?.matchedPurchaseRows ?? null;
    trace.suppliers = Array.isArray(result?.suppliers) ? result.suppliers.length : null;
  }
  if (call.name === "search_olap_fields") trace.count = result?.count ?? null;
  if (call.name === "run_olap_report") trace.success = result?.success === true;
  if (result?.error) trace.error = String(result.error).slice(0, 300);
  return trace;
}
async function runAssistant(env, connection, history, scope=null) {
  const model = clean(env.OPENAI_ASSISTANT_MODEL) || DEFAULT_MODEL;
  const base = {
    model,
    instructions: instructions(model, Boolean(connection)),
    tools: assistantToolDefinitions,
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "medium" },
    text: {
      format: {
        type: "json_schema",
        name: "smart_horeca_assistant_response",
        strict: true,
        schema: ASSISTANT_RESPONSE_SCHEMA
      }
    },
    max_output_tokens: 6000
  };

  let response = await openAiResponse(env, {
    ...base,
    input: inputFromHistory(history)
  });

  const traces = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = functionCalls(response);
    if (!calls.length) break;

    const outputs = [];
    for (const call of calls) {
      let result;
      try {
        if (!connection && call.name !== "list_smart_horeca_capabilities") {
          result = { error: "iiko не подключён в SmartHoreca. Откройте Настройки и подключите iiko Server." };
        } else {
          result = await executeAssistantTool(call.name, safeToolArgs(call.arguments), { env, connection, scope });
        }
      } catch (error) {
        result = { error: String(error?.message || error).slice(0, 1200) };
      }
      traces.push(compactToolTrace(call, result));
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }

    response = await openAiResponse(env, {
      ...base,
      previous_response_id: response.id,
      input: outputs
    });
  }

  const rawText = outputText(response);
  if (!rawText) throw new Error("AI не вернул ответ.");
  const structured = parseAssistantPayload(rawText);
  if (!structured.text && !structured.report && !structured.chart) throw new Error("AI вернул пустой ответ.");
  return {
    text: structured.text || structured.report?.title || structured.chart?.title || "Отчёт сформирован.",
    kind: structured.kind,
    report: structured.report,
    chart: structured.chart,
    model: response.model || model,
    responseId: response.id || null,
    usage: response.usage || null,
    tools: traces
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Требуется авторизация." }, 401);
    await ensureTables(env.DB);
    const url = new URL(request.url);
    const action = clean(url.searchParams.get("action") || "status");

    if (action === "status") {
      const iiko = await resolveIiko(env, auth.user.id);
      return json({
        success: true,
        configured: Boolean(clean(env.OPENAI_API_KEY)),
        model: clean(env.OPENAI_ASSISTANT_MODEL) || DEFAULT_MODEL,
        iikoConnected: iiko.connected,
        readOnly: true
      });
    }
    if (action === "conversations") {
      return json({ success: true, conversations: await listConversations(env.DB, auth.user.id) });
    }
    if (action === "messages") {
      const conversationId = clean(url.searchParams.get("conversationId"));
      if (!conversationId) return json({ success: false, message: "conversationId обязателен." }, 400);
      const conversation = await conversationById(env.DB, auth.user.id, conversationId);
      if (!conversation) return json({ success: false, message: "Чат не найден." }, 404);
      return json({
        success: true,
        conversation,
        messages: await recentMessages(env.DB, auth.user.id, conversationId, 30)
      });
    }
    return json({ success: false, message: "Неизвестное действие." }, 400);
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка AI Ассистента." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Требуется авторизация." }, 401);
    await ensureTables(env.DB);
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || "message");

    if (action === "newConversation") {
      const conversation = await createConversation(env.DB, auth.user.id, body.title || "Новый чат");
      return json({ success: true, conversation });
    }
    if (action === "deleteConversation") {
      const conversationId = clean(body.conversationId);
      if (!conversationId) return json({ success: false, message: "conversationId обязателен." }, 400);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM ai_assistant_messages WHERE conversation_id=?1 AND user_id=?2`).bind(conversationId, auth.user.id),
        env.DB.prepare(`DELETE FROM ai_assistant_conversations WHERE id=?1 AND user_id=?2`).bind(conversationId, auth.user.id)
      ]);
      return json({ success: true });
    }
    if (action !== "message") return json({ success: false, message: "Неизвестное действие." }, 400);

    const text = clean(body.message);
    if (!text) return json({ success: false, message: "Введите сообщение." }, 400);
    if (text.length > 8000) return json({ success: false, message: "Сообщение слишком длинное." }, 400);
    if (!clean(env.OPENAI_API_KEY)) return json({
      success: false,
      code: "OPENAI_NOT_CONFIGURED",
      message: "OPENAI_API_KEY не настроен для AI Ассистента."
    }, 503);

    let conversationId = clean(body.conversationId);
    let conversation = conversationId ? await conversationById(env.DB, auth.user.id, conversationId) : null;
    if (!conversation) {
      conversation = await createConversation(env.DB, auth.user.id, text.slice(0, 70));
      conversationId = conversation.id;
    }

    const existing = await recentMessages(env.DB, auth.user.id, conversationId, 1);
    await saveMessage(env.DB, auth.user.id, conversationId, "user", text);
    if (!existing.length || conversation.title === "Новый чат") {
      await touchConversation(env.DB, auth.user.id, conversationId, text.slice(0, 70));
    } else {
      await touchConversation(env.DB, auth.user.id, conversationId);
    }

    const iiko = await resolveIiko(env, auth.user.id, request, Array.isArray(body.departmentIds)?body.departmentIds:null);
    const history = await recentMessages(env.DB, auth.user.id, conversationId, MAX_HISTORY_MESSAGES);
    const answer = await runAssistant(env, iiko.connection, history, iiko.scope);
    const meta = {
      model: answer.model,
      responseId: answer.responseId,
      usage: answer.usage,
      tools: answer.tools,
      kind: answer.kind,
      report: answer.report,
      chart: answer.chart,
      restaurantScope: iiko.scope ? {
        mode:iiko.scope.mode,
        selectedDepartmentIds:iiko.scope.selectedDepartmentIds,
        selectedRestaurants:iiko.scope.selectedRestaurants
      } : null,
      readOnly: true
    };
    await saveMessage(env.DB, auth.user.id, conversationId, "assistant", answer.text, meta);
    await touchConversation(env.DB, auth.user.id, conversationId);

    return json({
      success: true,
      conversationId,
      answer: answer.text,
      meta
    });
  } catch (error) {
    console.error("[AI ASSISTANT]", error);
    return json({ success: false, message: error?.message || "Ошибка AI Ассистента." }, 500);
  }
}
