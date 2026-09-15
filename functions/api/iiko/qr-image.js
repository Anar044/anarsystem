import { iikoFetch } from "./_lib/iiko-client.js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
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
    const connection = {
      ip: String(body.ip || "").trim(),
      port: String(body.port || "").trim(),
      login: String(body.login || "").trim(),
      password: String(body.password || "")
    };
    const imageId = String(body.imageId || "").trim();

    if (!connection.ip || !connection.port || !connection.login || !connection.password || !imageId) {
      return json({ success: false, message: "Не хватает параметров iiko или imageId." }, 400);
    }

    // Different iiko/Syrve Server builds expose the stored product image
    // through slightly different image routes. Try the common variants.
    const encoded = encodeURIComponent(imageId);
    const candidates = [
      `/resto/api/v2/images/${encoded}`,
      `/resto/api/v2/images/${encoded}/download`,
      `/resto/api/images/${encoded}`,
      `/resto/api/v2/entities/products/image/${encoded}`
    ];

    const attempts = [];
    for (const path of candidates) {
      try {
        const { response, auth } = await iikoFetch(connection, path, {
          headers: { Accept: "image/*,*/*;q=0.8" }
        });
        const contentType = response.headers.get("content-type") || "";
        if (response.ok && contentType.toLowerCase().startsWith("image/")) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 0) {
            return json({
              success: true,
              imageId,
              mimeType: contentType.split(";")[0] || "image/jpeg",
              dataUrl: arrayBufferToDataUrl(buffer, contentType.split(";")[0] || "image/jpeg"),
              meta: {
                sharedIikoClient: true,
                authCacheHit: auth?.cacheHit === true
              }
            });
          }
        }
        attempts.push(`${path}: HTTP ${response.status} ${contentType}`);
      } catch (error) {
        attempts.push(`${path}: ${error?.message || error}`);
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
