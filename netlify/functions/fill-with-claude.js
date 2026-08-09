// netlify/functions/fill-with-claude.js
//
// Server-side proxy that lets the admin dashboard ask Claude to draft the
// empty fields on a product page. Runs on Netlify so the Anthropic API key
// never reaches the browser.
//
// SETUP (one-off):
//   1. Netlify → Site settings → Environment variables → add ANTHROPIC_API_KEY
//      (an API key from console.anthropic.com — this is separate from your
//      claude.ai login).
//   2. Deploy this file at netlify/functions/fill-with-claude.js alongside
//      your existing functions (same place as /api/config). Netlify picks
//      up any .js file in that folder automatically — no extra config needed.
//   3. The admin dashboard calls it at /api/fill-with-claude (redirect below),
//      or directly at /.netlify/functions/fill-with-claude if you haven't
//      set up the /api/* redirect.

const MODEL = 'claude-sonnet-5';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { product, category, attributeFields } = payload;
  if (!product || !product.brand || !product.name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'product.brand and product.name are required' }) };
  }

  const system = `You are helping fill in a product database for Wendy, an impartial AI baby-kit
adviser built by Baboodle (a UK baby-equipment rental company). Wendy tells expectant
parents what's worth renting, buying, or skipping for a specific configuration of a
pushchair (e.g. "carrycot" vs "seat unit" of the same pram).

You are filling in only the FUNCTIONAL / FACTUAL fields of a product page: description,
product type, suitable age range, dimensions, key highlights, the category-specific
"pram details" attributes, and the "who it's for" section (suitability tags and a
best-for explanation). You are never asked for and must never invent Wendy's rent/buy/
skip verdict, a verdict line, or any per-family reasoning — that is worked out live from
each family's own answers elsewhere in the app and is not a property of the product.

You will be given everything already known about one product configuration — much of
it is already filled in and correct; do not contradict it. Draft values ONLY for the
fields listed under "fields to fill", using the known facts (brand, model, category,
existing dimensions/specs, timeline role, tags) to stay consistent and specific.

For genuinely factual fields (dimensions, weight, age range, product type) you may draw
on general published knowledge of well-known mass-market products, but return null
rather than invent a specific figure you are not reasonably confident about — a wrong
dimension is worse than a blank one. Never invent a specific price, RRP, star rating, or
review count under any circumstances; those aren't in scope here anyway. Write in the
same plain, honest, slightly informal voice as the existing text (short sentences,
concrete, willing to name a genuine downside).

Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly
the keys listed under "fields to fill". Use null for anything you cannot responsibly
fill in. Arrays of strings should be plain JSON arrays (e.g. ["point one","point two"]),
each entry a few words to one short sentence.`;

  const user = {
    product,
    category,
    attribute_fields: attributeFields || [],
    instructions:
      'Fill in the fields listed in "fields to fill" below, grounded in "product". ' +
      'Leave a field null if you would be guessing at a hard fact (price, RRP, star rating, review count).',
    fields_to_fill: payload.fieldsToFill,
  };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(user) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', detail: errText }) };
    }

    const data = await resp.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No text in Claude response' }) };
    }

    let cleaned = textBlock.text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    }

    let filled;
    try {
      filled = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not parse JSON from Claude', raw: cleaned }) };
    }

    return { statusCode: 200, body: JSON.stringify({ filled }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
