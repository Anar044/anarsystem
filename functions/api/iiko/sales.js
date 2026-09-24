import { clean, getOlapFields, iikoText } from "./_lib/iiko-client.js";

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
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
        }
    });
}

function fieldName(fields, candidates) {
    const norm = value => clean(value).toLowerCase().replace(/[\s._()-]+/g, "");
    for (const candidate of candidates) {
        const item = fields.find(field => norm(field.name) === norm(candidate) || norm(field.title) === norm(candidate));
        if (item) return item.name;
    }
    for (const candidate of candidates) {
        const q = norm(candidate);
        const item = fields.find(field => norm(field.name).includes(q) || norm(field.title).includes(q));
        if (item) return item.name;
    }
    return null;
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders()
    });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const connection = {
            ip: clean(body.ip),
            port: clean(body.port),
            login: clean(body.login),
            password: String(body.password || "")
        };
        const from = clean(body.from);
        const to = clean(body.to);
        const departmentIds = [...new Set((Array.isArray(body.departmentIds) ? body.departmentIds : []).map(clean).filter(Boolean))];

        if (!connection.ip || !connection.port || !connection.login || !connection.password) {
            return jsonResponse({ success: false, message: "Заполните данные подключения" }, 400);
        }

        if (!from || !to) {
            return jsonResponse({ success: false, message: "Укажите период отчёта" }, 400);
        }

        if (from > to) {
            return jsonResponse({ success: false, message: "Дата начала больше даты окончания" }, 400);
        }

        const endDate = new Date(`${to}T00:00:00`);
        endDate.setDate(endDate.getDate() + 1);
        const endDateString =
            `${endDate.getFullYear()}-` +
            `${String(endDate.getMonth() + 1).padStart(2, "0")}-` +
            `${String(endDate.getDate()).padStart(2, "0")}`;

        const fieldResult = await getOlapFields(connection, "SALES");
        const fieldsCacheHit = fieldResult.cacheHit === true;
        const revenueField = fieldName(fieldResult.fields, ["DishDiscountSumInt", "DishSumInt", "Sales"]);
        const dateField = fieldName(fieldResult.fields, ["OpenDate.Typed", "OpenDate"]);
        const orderField = fieldName(fieldResult.fields, ["UniqOrderId", "UniqOrderId.Id"]);
        const departmentField = fieldName(fieldResult.fields, ["Department.Id", "DepartmentId", "Department.ID"]);
        if (!revenueField || !dateField) {
            return jsonResponse({ success: false, message: "Не найдены необходимые SALES OLAP поля даты/выручки" }, 502);
        }
        if (departmentIds.length && !departmentField) {
            return jsonResponse({
                success: false,
                message: "Не найдено OLAP-поле Department.Id — нельзя безопасно ограничить продажи выбранным рестораном"
            }, 502);
        }

        const filters = {
            [dateField]: {
                filterType: "DateRange",
                periodType: "CUSTOM",
                from,
                to: endDateString
            }
        };
        if (departmentField) {
            filters[departmentField] = {
                filterType: "IncludeValues",
                values: departmentIds
            };
        }

        const reportBody = {
            reportType: "SALES",
            buildSummary: true,
            groupByRowFields: [dateField],
            aggregateFields: [revenueField, ...(orderField ? [orderField] : [])],
            filters
        };

        const reportResponse = await iikoText(
            connection,
            "/resto/api/v2/reports/olap",
            {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify(reportBody)
            }
        );

        const text = reportResponse.text;
        if (!reportResponse.ok) {
            return jsonResponse({
                success: false,
                message: `iiko Server вернул HTTP ${reportResponse.status}`,
                details: text.substring(0, 3000)
            }, 502);
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        return jsonResponse({
            success: true,
            report: data,
            meta: {
                sharedIikoClient: true,
                authCacheHit: reportResponse.auth?.cacheHit === true,
                olapFieldsCacheHit: fieldsCacheHit,
                departmentScopeApplied: departmentIds.length > 0,
                departmentField,
                departmentIds,
                revenueField,
                dateField,
                orderField
            }
        });
    } catch (error) {
        return jsonResponse({
            success: false,
            message: error.message || "Ошибка получения отчёта"
        }, 502);
    }
}
