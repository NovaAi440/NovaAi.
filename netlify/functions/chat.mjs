/* NOVA AI model endpoint. Runs on Netlify. The API key is read from the environment and never sent to the browser.
   GET  /api/chat  -> { configured: boolean }
   POST /api/chat  -> { text, truncated, tier } or { code, message } with an HTTP error status. */

export const config = { path: "/api/chat" };

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
// Model ids for each tier the app asks for. Check these against the current model list before launch.
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };
const MAX_TURNS = 40;
const MAX_CHARS_PER_TURN = 60000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // requests per client address per minute, best effort (each serverless instance keeps its own count)
const hits = new Map();

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function clientKey(req) {
  return req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
}

function rateOk(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) { hits.set(key, { n: 1, reset: now + RATE_WINDOW_MS }); return true; }
  rec.n += 1;
  if (hits.size > 5000) hits.clear();
  return rec.n <= RATE_MAX;
}

function fail(status, code, message) {
  return json(status, { code, message });
}

// Turn the app's messages into Anthropic messages, attaching any images to the last user turn.
function buildMessages(messages, images) {
  const turns = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_TURN) }));
  if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return null;
  if (images.length) {
    const last = turns[turns.length - 1];
    last.content = [
      ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
      { type: "text", text: last.content },
    ];
  }
  return turns;
}

function parseImages(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > MAX_IMAGES) return null;
  const out = [];
  for (const img of list) {
    if (!img || !IMAGE_TYPES.includes(img.mediaType) || typeof img.data !== "string") return null;
    // base64 is about 4/3 of the byte size
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) return null;
    out.push({ mediaType: img.mediaType, data: img.data });
  }
  return out;
}

export default async (req) => {
  if (req.method === "GET") {
    return json(200, { configured: Boolean(process.env.ANTHROPIC_API_KEY) });
  }
  if (req.method !== "POST") return fail(405, "invalid_request", "Use POST.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(503, "ai_not_configured", "The AI service is not set up on this site yet.");

  if (!rateOk(clientKey(req))) return fail(429, "rate_limited", "Too many requests. Wait a moment, then try again.");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "prompt_too_large", "The request is too large.");

  let body;
  try { body = JSON.parse(raw); } catch (e) { return fail(400, "invalid_request", "The request is not valid JSON."); }

  const tier = MODELS[body.tier] ? body.tier : "default";
  const images = parseImages(body.images);
  if (images === null) return fail(400, "invalid_request", "One of the images is not supported or is too large.");
  const messages = Array.isArray(body.messages) ? buildMessages(body.messages, images) : null;
  if (!messages) return fail(400, "invalid_request", "Send at least one user message.");

  const payload = {
    model: MODELS[tier],
    max_tokens: body.json ? 1024 : 2048,
    messages,
  };
  if (body.json) {
    payload.system = "Reply with only valid JSON. No prose, no code fences.";
  }

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("chat: network error reaching the model service");
    return fail(502, "upstream_error", "Connection problem. Your message is kept. Press Retry.");
  }

  let data = null;
  try { data = await upstream.json(); } catch (e) { data = null; }

  if (!upstream.ok) {
    const status = upstream.status;
    console.error("chat: model service returned", status, data && data.error ? data.error.type : "");
    if (status === 401 || status === 403) return fail(503, "ai_not_configured", "The AI service is not set up correctly on this site.");
    if (status === 429) return fail(429, "rate_limited", "The AI service is busy. Wait a moment, then try again.");
    if (status === 400) return fail(400, "invalid_request", "The request could not be processed. Check your input.");
    return fail(502, "upstream_error", "Connection problem. Your message is kept. Press Retry.");
  }

  const text = Array.isArray(data && data.content)
    ? data.content.filter((b) => b && b.type === "text").map((b) => b.text).join("")
    : "";
  if (!text.trim()) return fail(502, "empty_completion", "The model returned nothing. Try rephrasing.");
  return json(200, { text, truncated: data.stop_reason === "max_tokens", tier });
};
