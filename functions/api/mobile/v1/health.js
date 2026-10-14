import { response } from "../_lib/context.js";

// Public connectivity check for Cloudflare Pages branch previews.
// Does not query private servers or expose connection details.
export async function onRequestGet() {
  return response({
    success: true,
    service: "Smart Horeca Owner Mobile API",
    version: "v1",
    status: "preview",
  });
}
