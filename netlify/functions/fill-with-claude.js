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

function htmlToText(html, maxChars) {
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
    .slice(0, maxChars || MAX_PAGE_TEXT_CHARS);
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

async function fetchPageText(url, maxChars) {
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
    const text = htmlToText(html, maxChars);
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

  const { product, category, attributeFields, sourceUrl, sourceUrls, searchHint } = payload;
  if (!product || !product.brand || !product.name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'product.brand and product.name are required' }) };
  }

  const urls = (Array.isArray(sourceUrls) ? sourceUrls : (sourceUrl ? [sourceUrl] : []))
    .filter(Boolean).slice(0, 3);

  let pageText = null;
  let pagesRead = 0;
  if (urls.length) {
    const perPageBudget = Math.max(3000, Math.floor(MAX_PAGE_TEXT_CHARS / urls.length));
    const results = await Promise.allSettled(urls.map((u) => fetchPageText(u, perPageBudget)));
    const parts = [];
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        parts.push(`=== Page ${i + 1}: ${urls[i]} ===\n${r.value}`);
        pagesRead++;
      } else {
        failures.push(`${urls[i]} \u2014 ${(r.reason && r.reason.message) || r.reason}`);
      }
    });
    if (!parts.length) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: `Couldn't read ${urls.length > 1 ? 'any of those pages' : 'that page'}`,
          detail: failures.join('; '),
        }),
      };
    }
    pageText = parts.join('\n\n');
    // partial failures aren't fatal — proceed with whichever pages worked, but
    // note it isn't surfaced to the client beyond the pagesRead count being lower
    // than urls.length; that's enough signal without over-complicating the UI.
  }

  const system = `You are helping fill in a product database for Wendy, an impartial AI baby-kit
adviser built by Baboodle (a UK baby-equipment rental company). Wendy tells expectant
parents what's worth renting, buying, or skipping for a specific configuration of a
pushchair (e.g. "carrycot" vs "seat unit" of the same pram).

CRITICAL — what "configuration" actually means: product.configuration_name (e.g.
"Carrycot" or "Seat") does NOT mean you are describing that attachment on its own, in
isolation. It means the whole pram — chassis, wheels, suspension, handling, everything
that makes it e.g. a running pram or an all-terrain pram — as equipped with that
attachment, which is how a parent would actually own and push it. Get this wrong and
every score/description ends up nonsensical: a "Carrycot" configuration of a running
pram is NOT a fabric bassinet being rated on how well it runs — it's the running pram,
running-frame and all, currently carrying a carrycot instead of the seat unit. For
anything about terrain, running, off-road capability, public transport, car boot fit,
or handling: that's almost entirely down to the chassis/wheels, which are identical
across configurations — score and describe the pram itself first, then note anything
the specific attachment (carrycot vs seat) genuinely changes for that particular
question (e.g. a carrycot doesn't recline for an older toddler; it may add bulk or
change the balance; a seat unit can face the parent). Do not write as if the carrycot
or seat unit is a standalone product with its own terrain/running ability — it isn't one.

This applies just as much to prose fields (description, summary, best_for_explanation,
highlights, etc.) as to scores — and it's easy to get wrong here specifically, because a
web search for "carrycot" often surfaces a page about the carrycot ACCESSORY sold on its
own, written by someone who never mentions the frame at all. Do not paraphrase a source
like that as-is. Structure any description/summary as: 1-2 sentences establishing what
KIND of pram this actually is and what makes the chassis distinctive (running pram with
off-road wheels and suspension / compact city pram / all-terrain, etc.), THEN what this
configuration's attachment adds for that stage of use. For example:
  BAD (attachment treated as standalone product): "The Cot S carrycot turns the Avi Spin
  into a complete newborn system from day one. It features a soft, padded memory-foam
  mattress with a fully flat sleep surface... The carrycot works exclusively with the
  Avi Spin frame but transforms a sport stroller into a viable newborn pram."
  GOOD (pram first, attachment second): "The Avi Spin is Cybex's running pram, built
  around a fixed front wheel, air-filled tyres and a suspension system for jogging on
  pavement or light trail. In this carrycot configuration it's equipped for newborns:
  a flat, padded sleep surface suitable from birth to around 6 months, with a
  UPF50+ canopy and mesh ventilation. The carrycot clips onto the same running chassis,
  so the terrain and handling are unchanged from the seat unit — only the ride position
  and use-by-age differ."
Never start a description with the attachment's name as the grammatical subject
("The Cot S carrycot...", "This seat unit...") — start with the pram.

CRITICAL — dimensions and weight specifically: this trips people up constantly, so be
deliberate about it. "dimensions_open", "dimensions_folded" and any weight field must be
for the COMPLETE PRAM AS USED — chassis, wheels and this configuration's attachment,
assembled together, exactly as a parent pushes it down the street or folds it to fit in
a car boot. This is NOT the same number as the attachment's own standalone product
dimensions. A carrycot is very often also sold and photographed as a free-standing
bassinet (on its own stand, or usable indoors detached from the pram) — its own listing
will confidently give you ITS dimensions and weight, e.g. as a shipping/packed size, and
that number will be smaller and different from the assembled pram's footprint. If you
use the carrycot-alone figure for "dimensions_open" you will be wrong. If a source only
gives you the attachment's standalone spec and you can't find the assembled pram's own
unfolded/folded dimensions (from the frame's own page, or a page that shows the complete
pram with that attachment fitted), leave the field null rather than guess or substitute
the attachment's own size.

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
${pageText ? `You have also been given extracted text from ${pagesRead > 1 ? pagesRead + ' specific pages' : 'a specific page'}
the user pointed you at, included below as "source_page_text" — treat ${pagesRead > 1 ? 'these' : 'this'} as the
strongest available source for this product; search only to fill in anything ${pagesRead > 1 ? 'they don\u2019t' : 'it doesn\u2019t'} cover.
${pagesRead > 1 ? `Each page is separated by a "=== Page N: <url> ===" heading. This commonly happens because
the product is sold in parts with separate listings — e.g. one page for the pram frame/chassis
and a separate page for the carrycot accessory sold alongside it. Combine facts from all the
pages, but when a field is specific to one part of the product, prefer whichever page actually
covers that part rather than the other one (e.g. take the carrycot's own weight from the
carrycot's page, not the frame's page).` : ''}` : ''}

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

    return { statusCode: 200, body: JSON.stringify({ filled, pagesRead, usedSearch: searchCount > 0 }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
