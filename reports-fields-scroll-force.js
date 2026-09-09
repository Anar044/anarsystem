(function () {
    "use strict";

    function forceFieldsScroll() {
        const builder = document.getElementById("olap-builder");
        const card = builder?.querySelector(".olap-fields-card");
        const fields = document.getElementById("olap-fields");
        if (!card || !fields) return;

        // Apply directly to the live DOM so no other stylesheet can make the
        // 258-field list stretch the whole page.
        card.style.setProperty("height", "700px", "important");
        card.style.setProperty("min-height", "700px", "important");
        card.style.setProperty("max-height", "700px", "important");
        card.style.setProperty("display", "flex", "important");
        card.style.setProperty("flex-direction", "column", "important");
        card.style.setProperty("overflow", "hidden", "important");
        card.style.setProperty("align-self", "start", "important");

        fields.style.setProperty("height", "auto", "important");
        fields.style.setProperty("min-height", "0", "important");
        fields.style.setProperty("max-height", "none", "important");
        fields.style.setProperty("flex", "1 1 auto", "important");
        fields.style.setProperty("overflow-y", "scroll", "important");
        fields.style.setProperty("overflow-x", "hidden", "important");
        fields.style.setProperty("overscroll-behavior", "contain", "important");
        fields.style.setProperty("scrollbar-gutter", "stable", "important");
        fields.style.setProperty("padding-right", "8px", "important");
    }

    function init() {
        forceFieldsScroll();
        const observer = new MutationObserver(forceFieldsScroll);
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener("resize", forceFieldsScroll);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
