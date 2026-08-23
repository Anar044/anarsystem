function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  try {
    const url = new URL(context.request.url);

    const reportType =
      url.searchParams.get("reportType") || "SALES";

    const baseUrl =
      context.env.IIKO_BASE_URL ||
      context.env.IIKO_SERVER_URL;

    const login =
      context.env.IIKO_LOGIN;

    const password =
      context.env.IIKO_PASSWORD;

    if (!baseUrl) {
      return jsonResponse(
        {
          ok: false,
          error: "IIKO_BASE_URL не настроен",
        },
        500
      );
    }

    if (!login || !password) {
      return jsonResponse(
        {
          ok: false,
          error: "IIKO_LOGIN или IIKO_PASSWORD не настроены",
        },
        500
      );
    }

    /*
     * 1. Получаем iiko token
     */

    const tokenUrl =
      `${baseUrl.replace(/\/$/, "")}/resto/api/auth?` +
      `login=${encodeURIComponent(login)}` +
      `&pass=${encodeURIComponent(password)}`;

    const tokenResponse = await fetch(tokenUrl);

    const tokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Ошибка авторизации iiko",
          status: tokenResponse.status,
          details: tokenText,
        },
        502
      );
    }

    const token = tokenText.trim();

    if (!token) {
      return jsonResponse(
        {
          ok: false,
          error: "iiko не вернул token",
        },
        502
      );
    }

    /*
     * 2. Запрашиваем OLAP columns
     */

    const columnsUrl =
      `${baseUrl.replace(/\/$/, "")}` +
      `/resto/api/v2/reports/olap/columns` +
      `?key=${encodeURIComponent(token)}` +
      `&reportType=${encodeURIComponent(reportType)}`;

    const columnsResponse = await fetch(columnsUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    const text = await columnsResponse.text();

    if (!columnsResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Ошибка получения OLAP columns",
          status: columnsResponse.status,
          details: text,
        },
        502
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "iiko вернул не JSON",
          raw: text,
        },
        502
      );
    }

    /*
     * 3. Нормализуем ответ
     */

    let fields = [];

    if (Array.isArray(data)) {
      fields = data;
    } else if (Array.isArray(data.columns)) {
      fields = data.columns;
    } else if (Array.isArray(data.fields)) {
      fields = data.fields;
    } else if (Array.isArray(data.data)) {
      fields = data.data;
    }

    return jsonResponse({
      ok: true,
      reportType,
      count: fields.length,
      fields,
      raw: data,
    });
  } catch (error) {
    console.error("OLAP COLUMNS ERROR:", error);

    return jsonResponse(
      {
        ok: false,
        error: error.message || "Unknown error",
      },
      500
    );
  }
}
