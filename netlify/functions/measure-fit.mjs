// Baboodle — photo fit checker (Netlify function)
// Receives a resized photo of a doorway or car boot with a sheet of A4 in shot,
// asks Claude to measure it, and returns the measurements as JSON.
// Photos are never stored.
//
// Environment variables (Netlify → Site configuration → Environment variables):
//   ANTHROPIC_API_KEY   required — from console.anthropic.com
//   ANTHROPIC_MODEL     optional — defaults to claude-sonnet-5-5
//   ALLOWED_ORIGINS     optional — comma separated, defaults to the Baboodle domains

const DEFAULT_ORIGINS = ["https://baboodle.co.uk", "https://www.baboodle.co.uk"];
const MAX_IMAGE_CHARS = 6_000_000; // ~4.5 MB of base64
const RATE_LIMIT = 6; // photos per IP per 10 minutes (best effort, per function instance)
const hits = new Map();

function allowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}

function cors(origin) {
  const ok = allowedOrigins().includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowedOrigins()[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT;
}

function promptFor(mode) {
  const common =
    "A sheet of A4 paper (21.0 cm × 29.7 cm) is in the photo as a size reference. " +
    "Use it to work out the scale, correcting for perspective as best you can. ";
  const format =
    'Reply with only JSON: {"reference_found": true or false, "width_cm": number or null, ' +
    '"height_cm": number or null, "depth_cm": number or null, "confidence": "high" | "medium" | "low", ' +
    '"note": "one short, friendly sentence for the parent"}. If you cannot see the A4 sheet or the ' +
    "opening, set reference_found to false, the numbers to null, and say what to retake in note.";
  if (mode === "boot") {
    return (
      "This photo shows the open boot of a car, where a parent wants to fit a folded double pram. " +
      common +
      "Estimate in centimetres: the boot opening width at its narrowest point (width_cm), the opening " +
      "height from the boot lip to the top of the opening or parcel shelf (height_cm), and the floor " +
      "depth from the boot lip to the back of the rear seats (depth_cm). " +
      format
    );
  }
  return (
    "This photo shows a doorway that a parent wants to push a double pram through. " +
    common +
    "Estimate the clear opening width in centimetres: the narrowest horizontal gap a pram must pass " +
    "through, between the door frame (or the open door and the frame) at roughly 40–90 cm above the " +
    "floor. Set depth_cm to null. " +
    format
  );
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

export default async (req, context) => {
  const origin = req.headers.get("origin") || "";
  const headers = cors(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ code: "method", error: "Use POST" }, 405, headers);
  if (!allowedOrigins().includes(origin)) return json({ code: "origin", error: "Not allowed" }, 403, headers);

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) return json({ code: "rate_limited", error: "Too many requests" }, 429, headers);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ code: "bad_request", error: "Invalid JSON" }, 400, headers);
  }

  const mode = body.mode === "boot" ? "boot" : "door";
  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  if (!image) return json({ code: "bad_image", error: "No image" }, 400, headers);
  if (image.length > MAX_IMAGE_CHARS) return json({ code: "too_large", error: "Image too large" }, 413, headers);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ code: "config", error: "Missing ANTHROPIC_API_KEY" }, 500, headers);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
              { type: "text", text: promptFor(mode) },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Anthropic error", res.status, detail.slice(0, 500));
      return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
    }

    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const result = extractJson(text);
    if (!result) return json({ code: "parse", error: "Could not read a measurement" }, 502, headers);

    const n = (v) => (typeof v === "number" && isFinite(v) && v > 0 && v < 400 ? Math.round(v * 2) / 2 : null);
    return json(
      {
        reference_found: !!result.reference_found,
        width_cm: n(result.width_cm),
        height_cm: n(result.height_cm),
        depth_cm: mode === "boot" ? n(result.depth_cm) : null,
        confidence: ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low",
        note: typeof result.note === "string" ? result.note.slice(0, 200) : "",
      },
      200,
      headers,
    );
  } catch (err) {
    console.error(err);
    return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
  }
};

export const config = { path: "/api/measure-fit" };
