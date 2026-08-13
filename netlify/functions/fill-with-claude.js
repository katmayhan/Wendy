// netlify/functions/fill-with-claude.js
//
// Server-side proxy that lets the admin dashboard ask Claude to draft the
// empty fields on a product page — either from general knowledge, or (better)
// by reading a specific retailer/brand product page you paste a URL for.
// Runs on Netlify so the Anthropic API key never reaches the browser.
//
// SETUP (one-off):
//   1. Netlify → Site settings → Environment variables → add ANTHROPIC_API_KEY
//      (an API key from console.anthropic.com — this is separate from your
//      claude.ai login).
//   2. Deploy this file at netlify/functions/fill-with-claude.js. Netlify
//      picks up any .js file in that folder automatically.
//   3. The admin dashboard calls it at /.netlify/functions/fill-with-claude
//      — that address always works with no extra redirect config needed.

const MODEL = 'claude-sonnet-5';
const PAGE_FETCH_TIMEOUT_MS = 9000;
const MAX_PAGE_TEXT_CHARS = 18000;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; WendyAdminBot/1.0; +https://wendyapp.netlify.app)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) {
      throw new Error(`Page returned HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text')) {
      throw new Error(`Page is not HTML (content-type: ${contentType})`);
    }
    const html = await resp.text();
    const text = htmlToText(html);
    if (!text || text.length < 100) {
      throw new Error('Page fetched but had almost no readable text (likely JS-rendered content the fetch couldn\u2019t see)');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

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

  const { product, category, attributeFields, sourceUrl } = payload;
  if (!product || !product.brand || !product.name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'product.brand and product.name are required' }) };
  }

  let pageText = null;
  if (sourceUrl) {
    try {
      pageText = await fetchPageText(sourceUrl);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `Couldn't read that page: ${e.message || e}` }),
      };
    }
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

${pageText ? `A page of extracted text from a product page the user gave you is included below as
"source_page_text". Treat it as the authoritative source for this product — extract facts
from it directly. It's raw extracted text, so it will contain some navigation and
boilerplate noise; ignore that and find the actual specs and description. If a field's
value genuinely isn't findable in that text, return null for it, even if you think you
might know it generally — don't blend in outside knowledge for factual fields when a
source page was provided. Write the description and highlights in Wendy's own plain,
honest voice rather than copying the retailer's marketing copy verbatim.`
  : `No source page was provided, so for genuinely factual fields (dimensions, weight, age
range, product type) you may draw on general published knowledge of well-known
mass-market products, but return null rather than invent a specific figure you are not
reasonably confident about — a wrong dimension is worse than a blank one.`}

Never invent a specific price, RRP, star rating, or review count under any circumstances;
those aren't in scope here anyway. Write in the same plain, honest, slightly informal
voice as the existing text (short sentences, concrete, willing to name a genuine
downside).

Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly
the keys listed under "fields to fill". Use null for anything you cannot responsibly
fill in. Arrays of strings should be plain JSON arrays (e.g. ["point one","point two"]),
each entry a few words to one short sentence.`;

  const user = {
    product,
    category,
    attribute_fields: attributeFields || [],
    source_page_text: pageText || undefined,
    instructions:
      'Fill in the fields listed in "fields to fill" below, grounded in "product"' +
      (pageText ? ' and "source_page_text".' : '.') +
      ' Leave a field null if you would be guessing at a hard fact (price, RRP, star rating, review count), ' +
      'or at anything not found in source_page_text when one is provided.',
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
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(user) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', detail: errText }) };
    }

    const data = await resp.json();

    if (data.type === 'error') {
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API returned an error', detail: data.error }) };
    }

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'No text block in Claude response — see detail for what actually came back',
          detail: {
            stop_reason: data.stop_reason,
            content_block_types: (data.content || []).map((b) => b.type),
            usage: data.usage,
            raw: JSON.stringify(data).slice(0, 1500),
          },
        }),
      };
    }

    let cleaned = textBlock.text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    }

    let filled;
    try {
      filled = JSON.parse(cleaned);
    } catch (e) {
      const truncated = data.stop_reason === 'max_tokens';
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: truncated
            ? 'Claude\u2019s reply was cut off before finishing (ran out of output budget) rather than malformed'
            : 'Could not parse JSON from Claude',
          detail: {
            stop_reason: data.stop_reason,
            usage: data.usage,
            parse_error: String(e.message || e),
            raw_tail: cleaned.slice(-400),
          },
        }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ filled, usedSourcePage: !!pageText }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
