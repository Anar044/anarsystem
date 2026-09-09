(function () {
    "use strict";

    // Keep the original OLAP logic untouched.
    // reports.js correctly consumes data.fields. Its recursive fallback over
    // data.raw can also see nested metadata labels (for example "Касса")
    // and incorrectly add them as technical OLAP fields.
    // For the fields response, expose only the authoritative normalized list.
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : (input?.url || "");

        if (!url.includes("/api/iiko/olap") || typeof init?.body !== "string") {
            return originalFetch(input, init);
        }

        try {
            const body = JSON.parse(init.body);
            if (body.action !== "fields") {
                return originalFetch(input, init);
            }

            const response = await originalFetch(input, init);
            const data = await response.clone().json();

            if (data && Array.isArray(data.fields)) {
                // reports.js gets its fields from data.fields only.
                // Removing raw prevents nested display metadata from being
                // interpreted as additional technical fields.
                delete data.raw;
                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }

            return response;
        } catch (_) {
            return originalFetch(input, init);
        }
    };
})();
