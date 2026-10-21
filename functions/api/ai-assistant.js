import { getUser } from "./iiko/_lib/user-state.js";
import { resolveAssistantIiko, assistantToolAuthorized } from "./iiko/_lib/ai-assistant-context.js";
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

const ASSISTANT_SCHEMA_READY = new WeakMap();
async function ensureTables(db) {
  if (!db) throw new Error("D1 binding DB не настроен.");
  const cached = ASSISTANT_SCHEMA_READY.get(db);
  if (cached) return cached;
  const initialize = (async () => {
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
  })();
  ASSISTANT_SCHEMA_READY.set(db, initialize);
  try { return await initialize; }
  catch(error) { ASSISTANT_SCHEMA_READY.delete(db); throw error; }
}
export function conversationScopeKey(iiko){
  // User ID alone is NOT an organization boundary. Non-CHAIN workspaces
  // previously shared the empty scope key, and CHAIN workspaces with an
  // identical set of department IDs also shared a history namespace.
  // Require the authenticated workspace identity before touching D1 chats.
  const workspaceId=clean(iiko?.access?.workspace?.id);
  if(!workspaceId) {
    const error=new Error("Не удалось подтвердить организацию для AI диалога.");
    error.code="AI_WORKSPACE_SCOPE_UNVERIFIED";
    error.status=403;
    throw error;
  }
  const scope=iiko?.scope;
  if(!scope?.isChain)return `WS:${workspaceId}:SINGLE`;
  const ids=[...new Set((scope.selectedDepartmentIds||[]).map(clean).filter(Boolean))].sort();
  if(!ids.length){
    const error=new Error("Для AI выберите разрешённые рестораны.");
    error.code="AI_RESTAURANT_SCOPE_EMPTY";
    error.status=403;
    throw error;
  }
  return `WS:${workspaceId}:CHAIN:${ids.join(",")}`;
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
export function assistantNeedsCompletion(response) {
  return !outputText(response) &&
    (response?.status === "incomplete" ||
      (response?.output || []).some(item => item?.type === "reasoning"));
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
export function mobileOwnerExecutiveInstructions() {
  return `
Дополнительные правила для мобильного владельца сети ресторанов:
- Отвечай прежде всего на управленческий вопрос: результат, важное сравнение и причина, если она подтверждается данными. Для конкретного показателя называй числовое значение, валюту AZN, период и число ресторанов, когда они известны из ответа инструмента.
- При сравнении двух периодов считай абсолютное отклонение и процент только по данным инструмента; используй знак и формулу ((новое-старое)/старое)*100. Если база равна нулю, процент не вычисляй.
- Различай календарный день и операционный день кассовых смен. Не утверждай, что оборот «сегодня» — это календарные продажи, когда запрос касается действующих кассовых смен.
- Не называй причину падения продаж, снижения прибыли или изменения среднего чека установленным фактом без сопоставимых данных (трафик, чеки, скидки, средний чек, себестоимость); иначе укажи это как гипотезу и предложи следующий полезный срез.
- Для вопросов «что изменилось», «где проблема» и «на что обратить внимание» приоритетно показывай 2–4 наиболее значимых, подтверждённых отклонения и короткие рекомендуемые проверки.
- Пользователь может говорить на русском, азербайджанском или английском. Сохраняй язык вопроса и естественно понимай голосовую транскрипцию, но не приписывай неясным названиям ресторанов уверенное совпадение.
- Если владелец просит сравнить рестораны, сравнивай только выбранные и разрешённые подразделения. Ни одна агрегированная сумма не может включать чужие организации, даже если источник вернул более широкую выборку.
- Если пользователь попросил график, создай структурированный chart на основе проверенных значений. При недостатке данных прямо напиши об ограничении и не рисуй вымышленных точек.
- Для вопросов о самых продаваемых и наименее продаваемых блюдах используй вначале get_dish_sales_rankings с календарным периодом пользователя. Этот инструмент получает реальные технические поля OLAP, сортирует исходные строки и проверяет ресторан для каждой строки; не заменяй его неподтверждёнными числами.
- Для вопроса об удалении блюд дай топ и низ продаж по проверенным данным, но не принимай решение о снятии блюда без себестоимости, валовой маржи, сезонности и доступности ингредиентов.
- При технической ошибке источника не пиши большое рассуждение вместо отчёта. Кратко скажи, что данные недоступны, укажи код источника, если он известен, и предложи повторить запрос позже; не утверждай без доказательств, что ошибка вызвана датами или числом ресторанов.
- Если данные отсутствуют для одного выбранного ресторана, не подменяй отсутствие данных нулевыми продажами. Не скрывай неполную выборку.
- Тон: лаконичный аналитик для владельца. Никакого лишнего описания внутренних API и технических полей, если пользователь не спрашивает о них.
`.trim();
}

export function assistantAnalyticQuestion(prompt) {
  const value = clean(prompt);
  return /топ|top|срав|анализ|analiz|отч[её]т|report|показател|динамик|график|диаграмм|выруч|прибыл|себестоим|скидк|средн.{0,8}чек|продаж|sales|revenue|profit|trend|compare|chart|grafik|müqayis|satış|gəlir|mənfəət|endirim|dinamik/i.test(value);
}

function instructions(model, connected, mobile = false) {
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
0. Старайся дать полезный конечный результат с проверенными цифрами, а не отправлять пользователя переделывать запрос. Для простого "топ-5 блюд" без периода по умолчанию используй сегодня и выручку, явно называя принятое допущение. Выбирай человекочитаемые названия блюд в OLAP. Если доступны только ID — смотри DisplayName, сопоставленный со справочником iiko; не утверждай, что названий вообще нет, не проверив справочник. Если имена недоступны, всё равно покажи проверяемые суммы и ID с указанием ограничения.
0a. Отвечай по существу: для запроса "топ-5" представь 5 позиций или объясни, сколько вернул источник; для сравнений покажи основные суммы и различия. Не придумывай пропущенные данные.
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

Модель: ${model}.
${mobile ? mobileOwnerExecutiveInstructions() : ""}`;
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
export function compactToolTrace(call, result) {
  // A tool can fail as {success:false,code,status,message} without throwing.
  // Treat that as a genuine source error, not as a completed data report.
  const failed = Boolean(result?.error) || result?.success === false;
  const trace = { name: call.name, ok: !failed };
  if (call.name === "search_products") trace.count = result?.count ?? null;
  if (call.name === "analyze_purchase_prices") {
    trace.matchedPurchaseRows = result?.matchedPurchaseRows ?? null;
    trace.suppliers = Array.isArray(result?.suppliers) ? result.suppliers.length : null;
  }
  if (call.name === "search_olap_fields") trace.count = result?.count ?? null;
  if (call.name === "run_olap_report" ||
      call.name === "get_dish_sales_rankings") {
    trace.success = result?.success === true;
  }
  if (failed) {
    trace.code = clean(result?.code) || "AI_TOOL_SOURCE_FAILED";
    const status = Number(result?.status);
    if (Number.isInteger(status) && status >= 400 && status <= 599)
      trace.status = status;
    // Never expose a raw server body or authorization header to the client.
    trace.error = clean(result?.message || result?.error)
      .slice(0, 240) || "Источник данных не ответил.";
  }
  return trace;
}
export function mobileRequiresSalesSource(prompt) {
  // Do not let the model decline a concrete sales report without first
  // attempting an authorized data lookup. General conversation stays fast.
  return /выруч|продаж|чек[иаов]?|по\s+ресторанам|сравни|сравнен|график|диаграм|рейтинг\s+блюд|revenue|sales|compare|chart|grafik|satış|gəlir|müqayis/i
    .test(clean(prompt));
}

export function assistantToolBudget({mobile=false, analytic=false} = {}) {
  // A comparison report commonly takes several dependent lookups:
  // first identify fields, then fetch verified OLAP rows, finally summarize.
  // A mobile transport must not silently prevent the last data fetch.
  return mobile && !analytic ? 4 : MAX_TOOL_ROUNDS;
}

export function assistantContinuationToolChoice(round, budget) {
  // After the final permitted set of read-only tool results, force a
  // conclusion (or an explicit missing-data warning), never an extra
  // unfulfilled function call.
  return round >= budget - 1 ? "none" : "auto";
}

async function runAssistant(env, connection, history, scope=null, access=null, mobile=false) {
  const model = clean(env.OPENAI_ASSISTANT_MODEL) || DEFAULT_MODEL;
  const prompt = clean(history?.at(-1)?.content);
  const analyticQuestion = assistantAnalyticQuestion(prompt);
  const base = {
    model,
    instructions: instructions(model, Boolean(connection), mobile),
    tools: assistantToolDefinitions,
    tool_choice: "auto",
    parallel_tool_calls: true,
    // Simple conversational questions remain fast, data analysis gets more
    // reasoning budget instead of always using the lowest mobile effort.
    reasoning: { effort: mobile && !analyticQuestion ? "low" : "medium" },
    text: {
      format: {
        type: "json_schema",
        name: "smart_horeca_assistant_response",
        strict: true,
        schema: ASSISTANT_RESPONSE_SCHEMA
      }
    },
    // Medium reasoning may consume the whole 4000-token mobile budget,
    // leaving no visible text. Reserve space to synthesize the final report.
    max_output_tokens: mobile ? 6000 : 6000
  };

  let response = await openAiResponse(env, {
    ...base,
    // Require at least one authorized read for a concrete sales question.
    // Avoid making "data unavailable" claims without checking the source.
    tool_choice: mobile && mobileRequiresSalesSource(prompt)
      ? "required" : "auto",
    input: inputFromHistory(history)
  });

  const traces = [];
  const toolBudget = assistantToolBudget({mobile, analytic:analyticQuestion});
  for (let round = 0; round < toolBudget; round++) {
    const calls = functionCalls(response);
    if (!calls.length) break;

    // The exposed tools are read-only. Dispatch independent model-requested
    // lookups concurrently while preserving their original response order.
    // Authorization and CHAIN scope are still checked for every tool call.
    const outcomes = await Promise.all(calls.map(async (call) => {
      let result;
      try {
        if (!connection && call.name !== "list_smart_horeca_capabilities") {
          result = { error: "Для выбранной организации не настроен Smart Horeca Server. Подключение выполняет администратор платформы.", code: "SH_SERVER_NOT_CONFIGURED" };
        } else if (!assistantToolAuthorized(access, call.name)) {
          result = { error: "Нет прав для использования этого источника данных Smart Horeca.", code: "ASSISTANT_TOOL_FORBIDDEN" };
        } else {
          result = await executeAssistantTool(call.name, safeToolArgs(call.arguments), { env, connection, scope });
        }
      } catch (error) {
        result = { error: String(error?.message || error).slice(0, 1200) };
      }
      return { call, result };
    }));
    const outputs = outcomes.map(({ call, result }) => {
      traces.push(compactToolTrace(call, result));
      return {
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      };
    });

    response = await openAiResponse(env, {
      ...base,
      previous_response_id: response.id,
      input: outputs,
      // Match the website's depth for real multi-step analytical reports.
      // Force the last response to be final only AFTER all required tool
      // results have had a chance to arrive.
      tool_choice: assistantContinuationToolChoice(round, toolBudget)
    });
  }

  // A completed OpenAI HTTP call does not guarantee an answer: models can
  // use their entire output budget for reasoning and return incomplete.
  // One controlled continuation is permitted, never an unbounded loop.
  if (assistantNeedsCompletion(response) && response?.id &&
      functionCalls(response).length === 0) {
    response = await openAiResponse(env, {
      ...base,
      previous_response_id: response.id,
      tool_choice: "none",
      input: [{role:"user",content:
        "Заверши ответ на предыдущий аналитический вопрос по уже " +
        "полученным данным. Не вызывай инструменты и не придумывай числа. " +
        "Верни краткий, полный JSON-ответ в заданной схеме."}]
    });
  }

  const rawText = outputText(response);
  if (!rawText) {
    const code = response?.incomplete_details?.reason ||
      (functionCalls(response).length ? "tool_rounds_exhausted" : "no_text");
    const err = new Error(
      "AI не смог завершить ответ. Попробуйте повторить вопрос, " +
      "выбрав меньше ресторанов или более короткий период.");
    err.code = "AI_RESPONSE_INCOMPLETE";
    err.reason = code;
    err.status = 502;
    throw err;
  }
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
    tools: traces,
    sourceWarnings: traces.filter(item=>!item.ok).map(item=>({
      name:item.name, code:item.code,
      ...(item.status?{status:item.status}:{})
    }))
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
      const iiko = await resolveAssistantIiko(env, request);
      return json({
        success: true,
        configured: Boolean(clean(env.OPENAI_API_KEY)),
        model: clean(env.OPENAI_ASSISTANT_MODEL) || DEFAULT_MODEL,
        iikoConnected: iiko.connected,
        readOnly: true
      });
    }
    if (action === "conversations") {
      const iiko=await resolveAssistantIiko(env,request);
      const scopeKey=conversationScopeKey(iiko);
      return json({ success: true, conversations: await listConversations(env.DB, auth.user.id, scopeKey), restaurantScope:iiko.scope?{mode:iiko.scope.mode,selectedDepartmentIds:iiko.scope.selectedDepartmentIds}:null });
    }
    if (action === "messages") {
      const conversationId = clean(url.searchParams.get("conversationId"));
      if (!conversationId) return json({ success: false, message: "conversationId обязателен." }, 400);
      const iiko=await resolveAssistantIiko(env,request);
      const scopeKey=conversationScopeKey(iiko);
      const conversation = await conversationById(env.DB, auth.user.id, conversationId, scopeKey);
      if (!conversation) return json({ success: false, message: "Чат не найден." }, 404);
      return json({
        success: true,
        conversation,
        messages: await recentMessages(env.DB, auth.user.id, conversationId, 30)
      });
    }
    return json({ success: false, message: "Неизвестное действие." }, 400);
  } catch (error) {
    return json({ success: false, code: error?.code || "AI_ASSISTANT_ERROR", message: error?.message || "Ошибка AI Ассистента." }, error?.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Требуется авторизация." }, 401);
    await ensureTables(env.DB);
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || "message");
    const iiko=await resolveAssistantIiko(env,request,Array.isArray(body.departmentIds)?body.departmentIds:null);
    const scopeKey=conversationScopeKey(iiko);

    if (action === "newConversation") {
      const conversation = await createConversation(env.DB, auth.user.id, scopeKey, body.title || "Новый чат");
      return json({ success: true, conversation });
    }
    if (action === "deleteConversation") {
      const conversationId = clean(body.conversationId);
      if (!conversationId) return json({ success: false, message: "conversationId обязателен." }, 400);
      const conversation=await conversationById(env.DB,auth.user.id,conversationId,scopeKey);
      if(!conversation)return json({success:false,message:"Чат не найден в выбранном ресторане."},404);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM ai_assistant_messages WHERE conversation_id=?1 AND user_id=?2`).bind(conversationId, auth.user.id),
        env.DB.prepare(`DELETE FROM ai_assistant_conversations WHERE id=?1 AND user_id=?2 AND scope_key=?3`).bind(conversationId, auth.user.id,scopeKey)
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
    let conversation = conversationId ? await conversationById(env.DB, auth.user.id, conversationId, scopeKey) : null;
    if (!conversation) {
      conversation = await createConversation(env.DB, auth.user.id, scopeKey, text.slice(0, 70));
      conversationId = conversation.id;
    }

    const existing = await recentMessages(env.DB, auth.user.id, conversationId, 1);
    await saveMessage(env.DB, auth.user.id, conversationId, "user", text);
    if (!existing.length || conversation.title === "Новый чат") {
      await touchConversation(env.DB, auth.user.id, conversationId, text.slice(0, 70));
    } else {
      await touchConversation(env.DB, auth.user.id, conversationId);
    }

    const history = await recentMessages(env.DB, auth.user.id, conversationId, MAX_HISTORY_MESSAGES);
    const isMobileOwner = request.headers.get("X-SH-Mobile-Strict-Scope") === "1";
    const answer = await runAssistant(env, iiko.connection, history, iiko.scope, iiko.access, isMobileOwner);
    const meta = {
      model: answer.model,
      responseId: answer.responseId,
      usage: answer.usage,
      tools: answer.tools,
      sourceWarnings: answer.sourceWarnings,
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
    return json({ success: false, code: error?.code || "AI_ASSISTANT_ERROR", message: error?.message || "Ошибка AI Ассистента." }, error?.status || 500);
  }
}
