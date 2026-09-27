import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in to use AI style variations." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
  if (!serviceKey) return json({ error: "Supabase server key is not configured." }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Your session has expired. Please sign in again." }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const sourceRef = String(body?.source_ref || "");
  const note = String(body?.note || "").trim().slice(0, 500);
  const outfit = String(body?.outfit || "outfit").trim().slice(0, 80);
  const colour = String(body?.colour || "").trim().slice(0, 80);
  const embroidery = String(body?.embroidery || "").trim().slice(0, 80);
  const sleeve = String(body?.sleeve || "").trim().slice(0, 80);
  const neck = String(body?.neck || "").trim().slice(0, 80);

  const prefix = "sb:style-photos/";
  if (!sourceRef.startsWith(prefix)) return json({ error: "Choose one of your uploaded style photos first." }, 400);
  const sourcePath = sourceRef.slice(prefix.length);
  if (!sourcePath.startsWith(user.id + "/")) return json({ error: "That style photo does not belong to your account." }, 403);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json({ error: "AI image generation is not configured yet.", setup_required: "OPENAI_API_KEY" }, 503);
  }

  const { data: source, error: downloadError } = await admin.storage.from("style-photos").download(sourcePath);
  if (downloadError || !source) return json({ error: "Could not read your reference photo." }, 400);

  const prompt = [
    "Edit the supplied fashion reference into a realistic, production-ready fashion concept.",
    "Preserve the garment's core identity, silhouette, neckline, sleeve construction, proportions, decorative placement and cultural styling from the reference.",
    "Do not invent a completely different outfit.",
    "Show the full garment clearly in a clean front-view fashion presentation on a simple neutral background.",
    "Keep details useful for a professional tailor to understand and reproduce.",
    "Avoid text, logos and watermarks.",
    outfit ? "Outfit category: " + outfit + "." : "",
    colour ? "Requested colour direction: " + colour + "." : "",
    sleeve ? "Requested sleeve: " + sleeve + "." : "",
    neck ? "Requested neckline: " + neck + "." : "",
    embroidery ? "Requested embroidery: " + embroidery + "." : "",
    note ? "Customer requested changes: " + note : "Make only subtle refinements unless required by the selected options.",
    "Create three distinct but faithful variations, not three unrelated designs.",
  ].filter(Boolean).join(" ");

  const form = new FormData();
  form.append("model", "gpt-image-2.5-sunburst");
  form.append("image", source, "reference.jpg");
  form.append("prompt", prompt);
  form.append("n", "3");
  form.append("size", "1024x1536");
  form.append("quality", "medium");
  form.append("output_format", "jpeg");

  const ai = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey },
    body: form,
  });

  const result = await ai.json();
  if (!ai.ok) {
    console.error("AI image error", result?.error?.type || "", result?.error?.code || "");
    const message = result?.error?.message || "The AI image service could not create variations.";
    return json({ error: message }, ai.status >= 400 && ai.status < 600 ? ai.status : 502);
  }

  const rows = Array.isArray(result?.data) ? result.data : [];
  if (!rows.length) return json({ error: "The AI image service returned no images." }, 502);

  const refs: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const b64 = rows[i]?.b64_json;
    if (!b64) continue;
    const path = user.id + "/ai-" + Date.now().toString(36) + "-" + i + "-" + crypto.randomUUID().slice(0, 8) + ".jpg";
    const bytes = decodeBase64(b64);
    const { error: uploadError } = await admin.storage
      .from("style-photos")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) continue;
    refs.push("sb:style-photos/" + path);
  }

  if (!refs.length) return json({ error: "The variations were created but could not be saved." }, 500);
  return json({ variations: refs, model: "gpt-image-2.5-sunburst" });
});
