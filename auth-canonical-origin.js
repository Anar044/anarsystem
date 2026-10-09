// Keep the authenticated invitation callback on the same Smart Horeca origin
// as the owner workspace/D1 records. Old Supabase Site URL previously pointed
// to anarsystem.pages.dev; codes/tokens must reach smarthoreca.pages.dev before
// the Supabase client consumes them. No query or fragment values are logged.
(function(){
  'use strict';
  try{
    const current=new URL(window.location.href);
    if(current.hostname.toLowerCase()!=='anarsystem.pages.dev')return;
    // Limit this legacy redirect to auth and password-reset routes. Other
    // anarsystem.pages.dev pages may still be used by their owners.
    const authPaths=new Set(['/auth-callback.html','/register.html','/login.html','/reset-password.html','/forgot-password.html']);
    if(!authPaths.has(current.pathname.toLowerCase()))return;
    current.hostname='smarthoreca.pages.dev';
    current.protocol='https:';
    current.port='';
    window.location.replace(current.toString());
  }catch(error){
    // Never expose Supabase auth fragments in logs.
    console.error('[AUTH] Could not route legacy authentication URL to Smart Horeca');
  }
})();
