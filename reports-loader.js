async function loadClassicScript(src) {
    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
        document.head.appendChild(script);
    });
}

try {
    await window.SH_ReportsContext?.prepare?.();
} catch (error) {
    console.warn("[reports-loader] iiko context unavailable; loading UI without saved connection", error);
}

// Load the legacy OLAP UI only after the safe server-side iiko context is ready.
// reports.js now initializes immediately when DOMContentLoaded has already fired.
await loadClassicScript("reports.js?v=20260914-runtime-1");
await loadClassicScript("reports-default-filters.js?v=20260914-cleanup-2");
await loadClassicScript("reports-fields-scroll-force.js?v=20260910-1");
await loadClassicScript("reports-result.js?v=20260910-6");
