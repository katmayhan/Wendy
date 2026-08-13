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

const MODEL = 'claude-haiku-4-5-20251001'; // fast — this task is structured extraction, not deep reasoning,
                                             // and Netlify's function execution window is tight
const PAGE_FETCH_TIMEOUT_MS = 6000;
const MAX_PAGE_TEXT_CHARS = 9000;
const CLAUDE_TIMEOUT_MS = 22000; // leaves headroom under Netlify's own function timeout, so we
                                   // return a clean error instead of Netlify's raw "Inactivity Timeout" page.
                                   // NOTE: if this function keeps timing out in practice, the real fix is
                                   // Netlify's function-duration limit for your plan (10s on some plans,
                                   // higher on Pro+) — that's a Netlify account setting, not something this
                                   // file can change from the inside.
const MAX_SEARCHES = 3;

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

function stripCitations(v) {
  if (typeof v === 'string') {
    return v
      .replace(/<cite[^>]*>/gi, '')
      .replace(/<\/cite>/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (Array.isArray(v)) return v.map(stripCitations);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = stripCitations(v[k]);
    return out;
  }
  return v;
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

  const { product, category, attributeFields, sourceUrl, searchHint } = payload;
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

You are filling in only the FUNCTIONAL / FACTUAL fields of ONE section of a product page
— exactly the keys listed under "fields_to_fill" below, nothing else. You are never asked
for and must never invent Wendy's rent/buy/skip verdict, a verdict line, or any
per-family reasoning — that is worked out live from each family's own answers elsewhere
in the app and is not a property of the product.

You will be given everything already known about this product configuration for context
— much of it is already correct; do not contradict it. Stay consistent with the brand,
model, category and existing specs you're given.

You have a web_search tool. Use it to find the specific product configuration named in
"product" (brand + name + configuration_name) on official brand or retailer sites — a UK
retailer if one is reasonably findable, since prices and specs sometimes differ by market.
${searchHint ? `The user has given you this exact search hint — use it as your primary
search query, it's more precise than what's in "product": "${searchHint}"` : ''}
${pageText ? `You have also been given extracted text from a specific page the user
pointed you at, included below as "source_page_text" — treat this as the strongest
available source for this product; search only to fill in anything it doesn't cover.` : ''}

Search results and any source_page_text are your primary evidence for factual fields
(dimensions, weight, age range, product type). Only fall back to general knowledge for a
field neither covers, and only when you're genuinely confident — return null rather than
invent a specific figure. A wrong dimension is worse than a blank one. Never invent a
specific price, RRP, star rating, or review count under any circumstances; those aren't
in scope here regardless. Write description/highlights/explanations in Wendy's own
plain, honest, slightly informal voice (short sentences, concrete, willing to name a
genuine downside) rather than copying retailer marketing copy verbatim.

Once you've gathered what you need, your FINAL message must be ONLY a single JSON
object, no markdown fences, no commentary before or after it, matching exactly the keys
listed under "fields_to_fill". Use null for anything you cannot responsibly fill in.
Arrays of strings should be plain JSON arrays (e.g. ["point one","point two"]), each
entry a few words to one short sentence.

IMPORTANT — no citation markup: when search results ground a claim, you'd normally cite the
source with <cite> tags. Do NOT do that here — every field value goes straight into a live
product database and app, as plain text a parent will read. Write plain prose only, with
no <cite> tags, no citation markers, no source attributions of any kind inside the field
values themselves.

IMPORTANT — nested spec fields: some entries in "fields_to_fill" look like "spec.some_key"
(a dot, then the attribute's key). These are NOT flat top-level keys — do not return a key
literally named "spec.some_key". Instead, nest all of them together inside a single
top-level "spec" object, using only the part after the dot as the key. For example, if
fields_to_fill contains "spec.ease_of_fold" and "spec.basket_access", your JSON must look
like: {"spec": {"ease_of_fold": <value>, "basket_access": <value>}, ...any other
non-spec fields at the top level...}. See "attribute_fields" for what each spec key means,
its type (score/select/boolean/etc), and its options.`;

  const user = {
    product,
    category,
    attribute_fields: attributeFields || [],
    source_page_text: pageText || undefined,
    search_hint: searchHint || undefined,
    fields_to_fill: payload.fieldsToFill,
  };

  try {
    const claudeController = new AbortController();
    const claudeTimer = setTimeout(() => claudeController.abort(), CLAUDE_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: claudeController.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: JSON.stringify(user) }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
        }),
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        return {
          statusCode: 504,
          body: JSON.stringify({
            error: 'Claude took too long to reply (this page may just be a lot of text to work through) \u2014 try again, or with a shorter/simpler product page',
          }),
        };
      }
      throw e;
    } finally {
      clearTimeout(claudeTimer);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API error', detail: errText }) };
    }

    const data = await resp.json();

    if (data.type === 'error') {
      return { statusCode: 502, body: JSON.stringify({ error: 'Anthropic API returned an error', detail: data.error }) };
    }

    const textBlocks = (data.content || []).filter((b) => b.type === 'text');
    if (!textBlocks.length) {
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
    const searchCount = (data.content || []).filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').length;

    let cleaned = textBlocks.map((b) => b.text).join('\n').trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    }
    // if there's commentary around the JSON (shouldn't happen given the instructions, but
    // web-search responses are more prone to it), fall back to the outermost {...} span
    if (cleaned[0] !== '{') {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
    }

    let filled;
    try {
      filled = JSON.parse(cleaned);
      filled = stripCitations(filled);
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

    return { statusCode: 200, body: JSON.stringify({ filled, usedSourcePage: !!pageText, usedSearch: searchCount > 0 }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
