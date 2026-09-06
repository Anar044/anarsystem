// SH_Reports — Supabase Auth configuration
// Replace the two values below with your Supabase project's public URL and publishable key.
// NEVER put the service_role/secret key in this file or in any browser code.
window.SH_AUTH_CONFIG = {
    url: "https://izytdfkdpbhmyuizuuut.supabase.co",
    publishableKey: "sb_publishable_OODMzFTaHq6DIoorXb85nQ_2FfwBXAS"
};

// Account data sync is intentionally loaded before auth.js so it can wait for
// the authenticated session and restore the user's cloud settings on any device.
(function () {
    if (document.getElementById("sh-account-sync-script")) return;
    const script = document.createElement("script");
    script.id = "sh-account-sync-script";
    script.src = "account-sync.js?v=1";
    document.head.appendChild(script);
})();
