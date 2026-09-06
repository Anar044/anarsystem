// SH_Reports — Supabase Auth configuration
// Replace the two values below with your Supabase project's public URL and publishable key.
// NEVER put the service_role/secret key in this file or in any browser code.
window.SH_AUTH_CONFIG = {
    url: "https://izytdfkdpbhmyuizuuut.supabase.co",
    publishableKey: "sb_publishable_OODMzFTaHq6DIoorXb85nQ_2FfwBXAS"
};

(function () {
    if (!document.getElementById("sh-account-sync-script")) {
        const script = document.createElement("script");
        script.id = "sh-account-sync-script";
        script.src = "account-sync.js?v=1";
        document.head.appendChild(script);
    }
    if (!document.getElementById("sh-cash-shifts-nav-script")) {
        const script = document.createElement("script");
        script.id = "sh-cash-shifts-nav-script";
        script.src = "cash-shifts-nav.js?v=1";
        document.head.appendChild(script);
    }
    if (!document.getElementById("sh-accounts-nav-script")) {
        const script = document.createElement("script");
        script.id = "sh-accounts-nav-script";
        script.src = "accounts-nav.js?v=1";
        document.head.appendChild(script);
    }
    if (!document.getElementById("sh-accounts-nav-fix-script")) {
        const script = document.createElement("script");
        script.id = "sh-accounts-nav-fix-script";
        script.src = "accounts-nav-fix.js?v=1";
        document.head.appendChild(script);
    }
    if (!document.getElementById("sh-finance-nav-script")) {
        const script = document.createElement("script");
        script.id = "sh-finance-nav-script";
        script.src = "finance-nav.js?v=1";
        document.head.appendChild(script);
    }
})();
