const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*"
};

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    success: true,
    bindings: {
      DB: Boolean(env?.DB)
    },
    checkedAt: new Date().toISOString()
  }), { status: 200, headers: HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}
