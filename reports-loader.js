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

await loadClassicScript("reports.js?v=20260914-cleanup-1");
