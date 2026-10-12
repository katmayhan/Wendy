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

function promptFor(mode, w, h) {
  const size = w && h ? `The image is ${w} × ${h} pixels (x to the right, y downwards, origin top-left). ` : "";
  const format =
    'Reply with only JSON, no other text: {"reference_found": true or false, "width_cm": number or null, ' +
    '"height_cm": number or null, "depth_cm": number or null, "confidence": "high" | "medium" | "low", ' +
    '"note": "one short, friendly sentence for the parent that does not include any measurements or numbers"}. If you cannot see the A4 sheet or the ' +
    "opening clearly, set reference_found to false, the numbers to null, and say what to retake in note.";
  if (mode === "boot") {
    return (
      "This photo shows the open boot of a car, where a parent wants to fit a folded double pram. " +
      "A sheet of A4 paper (21.0 × 29.7 cm) is in the photo as the size reference. Work out the scale carefully, " +
      "checking both sides of the sheet and correcting for perspective. " +
      "Estimate in centimetres: the boot opening width at its narrowest point (width_cm), the opening " +
      "height from the boot lip to the top of the opening or parcel shelf (height_cm), and the floor " +
      "depth from the boot lip to the back of the rear seats (depth_cm). " +
      format
    );
  }
  return (
    "This photo shows a doorway that a parent wants to push a double pram through. A sheet of A4 paper " +
    "(21.0 × 29.7 cm) is taped flat to the door frame or the wall beside it. " + size +
    "Your job is to LOCATE points precisely in pixel coordinates; the measuring maths is done afterwards. " +
    "Do NOT locate the door itself (the panel that swings). Ignore the door, whether open, ajar or closed. " +
    "Locate: (1) the four corners of the A4 sheet exactly as they appear in the image; " +
    "(2) the INSIDE edge of the LEFT upright of the door frame (the jamb the door hangs in, not the decorative trim on the wall), " +
    "at two heights about 50 cm and 90 cm above the floor; " +
    "(3) the INSIDE edge of the RIGHT upright of the door frame at the same two heights. " +
    "Also give your own direct estimate of the clear frame width in cm (jamb to jamb). " +
    'Reply with only JSON, no other text: {"reference_found": true or false, ' +
    '"paper": {"tl": [x,y], "tr": [x,y], "br": [x,y], "bl": [x,y]}, ' +
    '"left": [[x,y],[x,y]], "right": [[x,y],[x,y]], ' +
    '"width_cm": number, "confidence": "high" | "medium" | "low", ' +
    '"note": "one short, friendly sentence for the parent that does not include any measurements or numbers", "measured": "a few words on which edges you located"}. ' +
    "If you cannot see the A4 sheet or both sides of the frame, set reference_found to false and say what to retake in note."
  );
}

// ---- Perspective correction: map image pixels onto the plane of the A4 sheet (in cm) ----
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}
function apply(H, [x, y]) {
  const d = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && isFinite(v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function frameWidthFromPoints(r) {
  const P = r && r.paper;
  if (!P || ![P.tl, P.tr, P.br, P.bl].every(pt)) return null;
  if (!Array.isArray(r.left) || !Array.isArray(r.right) || r.left.length < 1 || r.right.length < 1) return null;
  if (![...r.left, ...r.right].every(pt)) return null;
  // Landscape or portrait sheet? Compare edge lengths in the image.
  const topLen = (dist(P.tl, P.tr) + dist(P.bl, P.br)) / 2;
  const sideLen = (dist(P.tl, P.bl) + dist(P.tr, P.br)) / 2;
  const [W, Hh] = topLen >= sideLen ? [29.7, 21.0] : [21.0, 29.7];
  const H = homography([P.tl, P.tr, P.br, P.bl], [[0, 0], [W, 0], [W, Hh], [0, Hh]]);
  if (!H) return null;
  const n = Math.min(r.left.length, r.right.length);
  const widths = [];
  for (let i = 0; i < n; i++) {
    const L = apply(H, r.left[i]), R = apply(H, r.right[i]);
    widths.push(Math.abs(R[0] - L[0]));
  }
  const avg = widths.reduce((a, c) => a + c, 0) / widths.length;
  return isFinite(avg) ? avg : null;
}

function extractJson(text) {
  text = String(text || "").trim();
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
  const imgW = Number(body.w) > 0 ? Math.round(Number(body.w)) : 0;
  const imgH = Number(body.h) > 0 ? Math.round(Number(body.h)) : 0;
  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  if (!image) return json({ code: "bad_image", error: "No image" }, 400, headers);
  if (image.length > MAX_IMAGE_CHARS) return json({ code: "too_large", error: "Image too large" }, 413, headers);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ code: "config", error: "Missing ANTHROPIC_API_KEY" }, 500, headers);

  try {
    const callClaude = (extra) =>
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
          max_tokens: 6000, // room for thinking plus the JSON answer
          ...extra,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
                { type: "text", text: promptFor(mode, imgW, imgH) },
              ],
            },
          ],
        }),
      });

    // Moderate thinking (medium effort) for accuracy. If the model doesn't accept that setting, retry without it.
    let res = await callClaude({ output_config: { effort: "medium" } });
    if (res.status === 400) {
      console.error("Low-effort request refused, retrying with defaults:", (await res.text()).slice(0, 300));
      res = await callClaude({});
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error("Anthropic error", res.status, detail.slice(0, 800));
      return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
    }

    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    console.log("measure-fit", mode, "stop:", data.stop_reason, "reply:", text.slice(0, 600));
    const result = extractJson(text);
    if (!result) {
      console.error("measure-fit could not parse reply");
      return json({ code: "parse", error: "Could not read a measurement", reply: text.slice(0, 300) }, 502, headers);
    }

    const n = (v) => {
      const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
      return isFinite(x) && x > 0 && x < 400 ? Math.round(x * 2) / 2 : null;
    };
    const found = result.reference_found === true || String(result.reference_found).toLowerCase() === "true";
    if (mode === "door" && found) {
      const computed = frameWidthFromPoints(result);
      console.log("measure-fit door computed_cm:", computed && computed.toFixed(1), "model_estimate_cm:", result.width_cm);
      const est = typeof result.width_cm === "number" ? result.width_cm : parseFloat(result.width_cm);
      if (computed && computed > 40 && computed < 150) {
        if (isFinite(est) && est > 40 && est < 150 && Math.abs(computed - est) > 6) {
          result.width_cm = (computed + est) / 2; // the two methods disagree: split the difference
          result.confidence = "low";
        } else {
          result.width_cm = computed;
        }
      }
      console.log("measure-fit door final_cm:", Number(result.width_cm).toFixed(1));
    }
    console.log("measure-fit result", JSON.stringify(result).slice(0, 500));
    return json(
      {
        reference_found: found,
        width_cm: n(result.width_cm),
        height_cm: n(result.height_cm),
        depth_cm: mode === "boot" ? n(result.depth_cm) : null,
        confidence: ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low",
        note: typeof result.note === "string" ? result.note.replace(/\s*(about|around|roughly|approximately)?\s*~?\d+(\.\d+)?\s*(cm|centimetres|centimeters)\b/gi, "").slice(0, 200) : "",
      },
      200,
      headers,
    );
  } catch (err) {
    console.error("measure-fit exception", err && (err.stack || err.message || err));
    return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
  }
};

export const config = { path: "/api/measure-fit" };
