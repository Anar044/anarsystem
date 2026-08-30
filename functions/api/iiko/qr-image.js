const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha1(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function auth(ip, port, login, password) {
  const serverUrl = `http://${ip}:${port}`;
  const passwordHash = await sha1(password);
  const response = await fetch(`${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${passwordHash}`);
  const token = (await response.text()).trim();
  if (!response.ok || !token) throw new Error(`Ошибка авторизации iiko: HTTP ${response.status}`);
  return { serverUrl, token };
}

function arrayBufferToDataUrl(buffer, contentType) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const ip = String(body.ip || "").trim();
    const port = String(body.port || "").trim();
    const login = String(body.login || "").trim();
    const password = String(body.password || "");
    const imageId = String(body.imageId || "").trim();

    if (!ip || !port || !login || !password || !imageId) {
      return json({ success: false, message: "Не хватает параметров iiko или imageId." }, 400);
    }

    const { serverUrl, token } = await auth(ip, port, login, password);

    // Different iiko/Syrve Server builds expose the stored product image
    // through slightly different image routes. Try the common variants.
    const candidates = [
      `${serverUrl}/resto/api/v2/images/${encodeURIComponent(imageId)}?key=${encodeURIComponent(token)}`,
      `${serverUrl}/resto/api/v2/images/${encodeURIComponent(imageId)}/download?key=${encodeURIComponent(token)}`,
      `${serverUrl}/resto/api/images/${encodeURIComponent(imageId)}?key=${encodeURIComponent(token)}`,
      `${serverUrl}/resto/api/v2/entities/products/image/${encodeURIComponent(imageId)}?key=${encodeURIComponent(token)}`
    ];

    const attempts = [];
    for (const url of candidates) {
      try {
        const response = await fetch(url, { headers: { Accept: "image/*,*/*;q=0.8" } });
        const contentType = response.headers.get("content-type") || "";
        if (response.ok && contentType.toLowerCase().startsWith("image/")) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 0) {
            return json({
              success: true,
              imageId,
              mimeType: contentType.split(";")[0] || "image/jpeg",
              dataUrl: arrayBufferToDataUrl(buffer, contentType.split(";")[0] || "image/jpeg")
            });
          }
        }
        attempts.push(`${new URL(url).pathname}: HTTP ${response.status} ${contentType}`);
      } catch (error) {
        attempts.push(`${new URL(url).pathname}: ${error?.message || error}`);
      }
    }

    return json({
      success: false,
      imageId,
      message: "iiko вернул frontImageId, но изображение не удалось получить через доступные image endpoints.",
      attempts
    }, 404);
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка получения изображения iiko." }, 502);
  }
}
