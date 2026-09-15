import { iikoJson } from "./_lib/iiko-client.js";

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() }
    });
}

function recordsFrom(payload) {
    if (!payload || typeof payload !== "object") return [];
    const groups = [
        ["CARD", payload.cashlessRecords],
        ["PAYIN", payload.payInRecords],
        ["PAYOUT", payload.payOutRecords || payload.payOuts]
    ];
    const result = [];
    for (const [fallbackGroup, list] of groups) {
        if (!Array.isArray(list)) continue;
        for (const record of list) {
            const info = record?.info || {};
            result.push({
                id: info.id ?? record.id ?? null,
                group: info.group ?? record.group ?? fallbackGroup,
                sum: info.sum ?? record.sum ?? record.actualSum ?? record.originalSum ?? null,
                actualSum: record.actualSum ?? null,
                originalSum: record.originalSum ?? info.sum ?? null,
                accountId: info.accountId ?? record.accountId ?? record.editedPayAccountId ?? record.originalPayAccountId ?? null,
                counteragentId: info.counteragentId ?? record.counteragentId ?? null,
                paymentTypeId: info.paymentTypeId ?? record.paymentTypeId ?? null,
                type: info.type ?? record.type ?? null,
                cashierId: info.cashierId ?? record.cashierId ?? null,
                date: info.date ?? record.date ?? null,
                creationDate: info.creationDate ?? record.creationDate ?? null,
                comment: info.comment ?? record.comment ?? record.editableComment ?? "",
                status: record.status ?? info.status ?? null
            });
        }
    }
    return result;
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const connection = {
            ip: String(body.ip || "").trim(),
            port: String(body.port || "").trim(),
            login: String(body.login || "").trim(),
            password: String(body.password || "")
        };
        const sessionId = String(body.sessionId || body.sessionID || body.id || "").trim();

        if (!connection.ip || !connection.port || !connection.login || !connection.password) return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль SH Server" }, 400);
        if (!sessionId) return jsonResponse({ success: false, message: "Не указан ID кассовой смены" }, 400);

        const sid = encodeURIComponent(sessionId);
        const [shiftResult, paymentsResult] = await Promise.all([
            iikoJson(connection, `/resto/api/v2/cashshifts/byId/${sid}`),
            iikoJson(connection, `/resto/api/v2/cashshifts/payments/list/${sid}?hideAccepted=false`)
        ]);

        if (!shiftResult.ok || !shiftResult.payload || typeof shiftResult.payload !== "object") {
            return jsonResponse({ success: false, message: `Не удалось получить смену: HTTP ${shiftResult.status}`, details: shiftResult.text.slice(0, 1000) }, 502);
        }

        const paymentsPayload = paymentsResult.payload && typeof paymentsResult.payload === "object" ? paymentsResult.payload : {};
        const payments = recordsFrom(paymentsPayload);
        const shift = shiftResult.payload;

        return jsonResponse({
            success: true,
            sessionId,
            shift,
            payments,
            paymentGroups: {
                cashlessRecords: Array.isArray(paymentsPayload.cashlessRecords) ? paymentsPayload.cashlessRecords : [],
                payInRecords: Array.isArray(paymentsPayload.payInRecords) ? paymentsPayload.payInRecords : [],
                payOutRecords: Array.isArray(paymentsPayload.payOutRecords) ? paymentsPayload.payOutRecords : (Array.isArray(paymentsPayload.payOuts) ? paymentsPayload.payOuts : [])
            },
            paymentsLoaded: paymentsResult.ok,
            paymentsStatus: paymentsResult.status,
            operationDay: paymentsPayload.operationDay || null,
            meta: {
                sharedIikoClient: true,
                authCacheHit: shiftResult.auth?.cacheHit === true || paymentsResult.auth?.cacheHit === true
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения деталей кассовой смены" }, 502);
    }
}
