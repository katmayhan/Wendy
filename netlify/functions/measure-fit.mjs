// Baboodle — photo fit checker (Netlify function)
// Measures a doorway or car boot from one phone photo, with no props needed:
//   • Doors: uses the standard UK door height (about 198 cm) as the scale, corrects for
//     perspective, then snaps to the nearest standard UK doorway width when close.
//   • Car boots: uses the UK number plate (52 × 11.1 cm) as the scale.
// Claude only locates points in the photo; the measuring maths is done here in code.
// Photos are never stored.
//
// Environment variables (Netlify → Project configuration → Environment variables):
//   ANTHROPIC_API_KEY   required — from console.anthropic.com
//   ANTHROPIC_MODEL     optional — defaults to claude-sonnet-5-5
//   ALLOWED_ORIGINS     optional — comma separated, defaults to the Baboodle domains

const DEFAULT_ORIGINS = ["https://baboodle.co.uk", "https://www.baboodle.co.uk"];
const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB of base64
const RATE_LIMIT = 8; // photos per IP per 10 minutes (best effort, per function instance)
const hits = new Map();

// Door opening heights (cm): standard UK doors are 1981 mm; frames a little more.
const DOOR_HEIGHT_CM = { standard: 198.5, tall: 210 };
// Typical clear frame widths (cm) for standard UK door sizes, used to snap close results.
const STANDARD_FRAME_WIDTHS = [62, 69.5, 72, 77, 82, 84.5, 92.5];
const SNAP_WITHIN_CM = 1; // only nudge results that are already within 1 cm of a standard size
// UK number plate (cm).
const PLATE_W = 52, PLATE_H = 11.1;

function allowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
function cors(origin) {
  const list = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": list.includes(origin) ? origin : list[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}
function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function rateLimited(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT;
}

// ---------------- Prompts ----------------
function promptFor(mode, w, h) {
  const size = w && h ? `The image is ${w} × ${h} pixels (x to the right, y downwards, origin top-left). ` : "";
  const noteRule = '"note": "one short, friendly sentence for the parent, with no measurements or numbers"';
  if (mode === "boot") {
    return (
      "This photo shows the open boot of a car, taken from behind, where a parent wants to fit a folded double pram. " + size +
      "Your job is to LOCATE points precisely in pixel coordinates; the measuring maths is done afterwards. " +
      "Locate: (1) the four corners of the rear UK number plate (the plate itself, 52 × 11 cm), if it is visible; " +
      "(2) the narrowest part of the boot OPENING: one point on its left edge and one on its right edge at the same height; " +
      "(3) the opening's top edge (bottom of the open tailgate/parcel shelf line) and its bottom edge (the boot lip), each as one point. " +
      "Also give your own direct estimates in cm: opening width, opening height, and floor depth from the lip to the back of the rear seats. " +
      'Reply with only JSON, no other text: {"ok": true or false, "plate": {"tl":[x,y],"tr":[x,y],"br":[x,y],"bl":[x,y]} or null, ' +
      '"left":[x,y], "right":[x,y], "top":[x,y], "lip":[x,y], "width_cm": number, "height_cm": number, "depth_cm": number, ' +
      '"confidence": "high" | "medium" | "low", ' + noteRule + "}. " +
      "If you cannot see the boot opening clearly, set ok to false and say in note what to retake."
    );
  }
  return (
    "This photo shows a doorway that a parent wants to push a double pram through. " + size +
    "Your job is to LOCATE points precisely in pixel coordinates; the measuring maths is done afterwards. " +
    "We want the DOOR FRAME OPENING, the empty space a pram passes through. Ignore the door panel itself, whether open, ajar or closed, " +
    "and ignore the decorative trim on the wall around the frame. " +
    "Locate the four inside corners of the frame opening: top-left and top-right (where the inside edges of the two uprights meet the " +
    "underside of the top of the frame) and bottom-left and bottom-right (where the inside edges of the uprights meet the floor or threshold). " +
    "Also say whether the doorway looks like a standard-height UK door (about 2 m) or noticeably taller (for example a period property or " +
    "a front door with a glazed panel above it inside the frame), and give your own direct estimate of the frame width in cm. " +
    'Reply with only JSON, no other text: {"ok": true or false, "frame": {"tl":[x,y],"tr":[x,y],"bl":[x,y],"br":[x,y]}, ' +
    '"height_class": "standard" | "tall", "width_cm": number, "confidence": "high" | "medium" | "low", ' + noteRule + "}. " +
    "If the whole frame from floor to top is not in the photo, set ok to false and say in note what to retake."
  );
}

// ---------------- Geometry helpers ----------------
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && isFinite(v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Aspect ratio (width / height) of a real rectangle seen in perspective (Zhang & He method).
// m1 = top-left, m2 = top-right, m3 = bottom-left, m4 = bottom-right, in pixels.
function rectAspect(m1p, m2p, m3p, m4p, imgW, imgH) {
  const simple = ((dist(m1p, m2p) + dist(m3p, m4p)) / 2) / ((dist(m1p, m3p) + dist(m2p, m4p)) / 2);
  if (!imgW || !imgH) return simple;
  const u0 = imgW / 2, v0 = imgH / 2;
  const h = (p) => [p[0], p[1], 1];
  const m1 = h(m1p), m2 = h(m2p), m3 = h(m3p), m4 = h(m4p);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  let f2 = -(
    n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0 +
    n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0
  ) / (n2[2] * n3[2]);
  // Fall back to a typical phone focal length when the view is nearly straight-on (unstable estimate).
  const fTypical = 0.8 * Math.max(imgW, imgH);
  if (!isFinite(f2) || f2 <= 0 || Math.sqrt(f2) < 0.3 * fTypical || Math.sqrt(f2) > 3 * fTypical) f2 = fTypical * fTypical;
  // n^T (A^-T A^-1) n with A = [[f,0,u0],[0,f,v0],[0,0,1]]
  const q = (n) => {
    const a = n[0] - u0 * n[2], b = n[1] - v0 * n[2];
    return (a * a + b * b) / f2 + n[2] * n[2];
  };
  const r = Math.sqrt(q(n2) / q(n3));
  if (!isFinite(r) || r <= 0) return simple;
  // Guard against wild results: trust the simple ratio if they disagree hugely.
  return Math.abs(r - simple) / simple > 0.35 ? simple : r;
}

// Homography helpers (image → plane of a known rectangle, in cm).
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

// ---------------- Measurements ----------------
function measureDoor(r, imgW, imgH) {
  const F = r && r.frame;
  if (!F || ![F.tl, F.tr, F.bl, F.br].every(pt)) return null;
  const heightCm = r.height_class === "tall" ? DOOR_HEIGHT_CM.tall : DOOR_HEIGHT_CM.standard;
  const aspect = rectAspect(F.tl, F.tr, F.bl, F.br, imgW, imgH);
  const raw = aspect * heightCm;
  if (!isFinite(raw) || raw < 40 || raw > 150) return null;
  let snapped = raw;
  let best = null;
  for (const s of STANDARD_FRAME_WIDTHS) if (best === null || Math.abs(s - raw) < Math.abs(best - raw)) best = s;
  if (best !== null && Math.abs(best - raw) <= SNAP_WITHIN_CM) snapped = best;
  return { raw, snapped, heightCm, aspect };
}
function measureBoot(r) {
  const P = r && r.plate;
  if (!P || ![P.tl, P.tr, P.br, P.bl].every(pt)) return null;
  const H = homography([P.tl, P.tr, P.br, P.bl], [[0, 0], [PLATE_W, 0], [PLATE_W, PLATE_H], [0, PLATE_H]]);
  if (!H) return null;
  const out = {};
  if (pt(r.left) && pt(r.right)) {
    const L = apply(H, r.left), R = apply(H, r.right);
    out.width = Math.abs(R[0] - L[0]);
  }
  if (pt(r.top) && pt(r.lip)) {
    const T = apply(H, r.top), B = apply(H, r.lip);
    out.height = Math.abs(B[1] - T[1]);
  }
  return out;
}

function extractJson(text) {
  text = String(text || "").trim();
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start !== -1 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}
const num = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return isFinite(x) && x > 0 && x < 400 ? x : null;
};
const half = (x) => (x == null ? null : Math.round(x * 2) / 2);
const cleanNote = (n) =>
  typeof n === "string"
    ? n.replace(/\s*(about|around|roughly|approximately)?\s*~?\d+(\.\d+)?\s*(cm|centimetres|centimeters|mm)\b/gi, "").slice(0, 200)
    : "";

// ---------------- Handler ----------------
export default async (req, context) => {
  const origin = req.headers.get("origin") || "";
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ code: "method", error: "Use POST" }, 405, headers);
  if (!allowedOrigins().includes(origin)) return json({ code: "origin", error: "Not allowed" }, 403, headers);

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) return json({ code: "rate_limited", error: "Too many requests" }, 429, headers);

  let body;
  try { body = await req.json(); } catch { return json({ code: "bad_request", error: "Invalid JSON" }, 400, headers); }

  const mode = body.mode === "boot" ? "boot" : "door";
  const imgW = Number(body.w) > 0 ? Math.round(Number(body.w)) : 0;
  const imgH = Number(body.h) > 0 ? Math.round(Number(body.h)) : 0;
  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  if (!image) return json({ code: "bad_image", error: "No image" }, 400, headers);
  if (image.length > MAX_IMAGE_CHARS) return json({ code: "too_large", error: "Image too large" }, 413, headers);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ code: "config", error: "Missing ANTHROPIC_API_KEY" }, 500, headers);

  const callClaude = (extra) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 6000, // room for thinking plus the JSON answer
        ...extra,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: promptFor(mode, imgW, imgH) },
          ],
        }],
      }),
    });

  try {
    let res = await callClaude({ output_config: { effort: "medium" } });
    if (res.status === 400) {
      console.error("Effort setting refused, retrying with defaults:", (await res.text()).slice(0, 300));
      res = await callClaude({});
    }
    if (!res.ok) {
      console.error("Anthropic error", res.status, (await res.text()).slice(0, 800));
      return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
    }

    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    console.log("measure-fit", mode, "stop:", data.stop_reason, "reply:", text.slice(0, 600));
    const r = extractJson(text);
    if (!r) {
      console.error("measure-fit could not parse reply");
      return json({ code: "parse", error: "Could not read a measurement" }, 502, headers);
    }
    const ok = r.ok === true || String(r.ok).toLowerCase() === "true";
    if (!ok) {
      return json({ reference_found: false, width_cm: null, height_cm: null, depth_cm: null, confidence: "low", note: cleanNote(r.note) }, 200, headers);
    }

    let width = num(r.width_cm), height = num(r.height_cm), depth = num(r.depth_cm);
    let confidence = ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low";

    let corners = null;
    if (mode === "door") {
      const F = r.frame;
      if (F && [F.tl, F.tr, F.bl, F.br].every(pt) && imgW && imgH) {
        const n = (p) => [Math.min(1, Math.max(0, p[0] / imgW)), Math.min(1, Math.max(0, p[1] / imgH))];
        corners = { tl: n(F.tl), tr: n(F.tr), bl: n(F.bl), br: n(F.br) };
      }
      const m = measureDoor(r, imgW, imgH);
      console.log("measure-fit door", JSON.stringify({ computed: m && +m.raw.toFixed(1), snapped: m && m.snapped, heightClass: r.height_class, modelEstimate: width }));
      if (m) {
        if (width && Math.abs(m.raw - width) > 8) {
          // The two disagree a lot: blend them and flag as low confidence.
          width = (m.raw + width) / 2;
          confidence = "low";
        } else {
          width = m.snapped;
        }
      }
      height = null; depth = null;
    } else {
      const m = measureBoot(r);
      console.log("measure-fit boot", JSON.stringify({ plateWidth: m && m.width, plateHeight: m && m.height, modelEstimate: { width, height, depth } }));
      if (m && m.width && m.width > 50 && m.width < 200) width = m.width;
      if (m && m.height && m.height > 20 && m.height < 150) height = m.height;
      if (!m) confidence = "low";
    }

    const extra = mode === "door" ? { corners, height_class: r.height_class === "tall" ? "tall" : "standard" } : {};
    if (!width) {
      return json({ reference_found: false, width_cm: null, height_cm: null, depth_cm: null, confidence: "low", note: cleanNote(r.note) || "We couldn't measure that photo. Try again from straight in front.", ...extra }, 200, headers);
    }
    console.log("measure-fit final", JSON.stringify({ width: half(width), height: half(height), depth: half(depth), confidence }));
    return json({ reference_found: true, width_cm: half(width), height_cm: half(height), depth_cm: half(depth), confidence, note: cleanNote(r.note), ...extra }, 200, headers);
  } catch (err) {
    console.error("measure-fit exception", err && (err.stack || err.message || err));
    return json({ code: "upstream", error: "Measuring failed" }, 502, headers);
  }
};

export const config = { path: "/api/measure-fit" };


export const config = { path: "/api/measure-fit" };
