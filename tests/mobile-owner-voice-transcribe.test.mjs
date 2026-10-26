import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {onRequestPost} from "../functions/api/mobile/v1/transcribe.js";

test("mobile transcription refuses unauthenticated requests without an OpenAI or iiko call",async()=>{
 const request=new Request("https://example.test/api/mobile/v1/transcribe",{
   method:"POST",headers:{"X-SH-Voice-Language":"az"}
 });
 const result=await onRequestPost({request,env:{OPENAI_API_KEY:"fake-secret"}});
 assert.equal(result.status,401);
 assert.equal((await result.json()).code,"TOKEN_REQUIRED");
});
test("Azerbaijani voice endpoint is owner-scoped and isolated from iiko",()=>{
 const source=readFileSync("functions/api/mobile/v1/transcribe.js","utf8");
 assert.match(source,/await mobileContext\(request, env\)/);
 assert.match(source,/gpt-transcribe/);
 assert.match(source,/Azerbaijani in Azerbaijani Latin script/);
 assert.match(source,/MAX_AUDIO_BYTES/);
 assert.match(source,/request\.formData\(\)/);
 assert.doesNotMatch(source,/\/resto\/api\/auth|getIikoAuth|IIKO_SESSION_BROKER/);
 assert.doesNotMatch(source,/OPENAI_API_KEY[^;]*response\(/);
});
