// Netlify serverless function: stores Wendy data in Supabase.
// The app POSTs { action, customerId, payload } here; this function writes to
// Supabase using the service-role key (kept server-side, never in the browser).
//
// Required env vars (set in Netlify → Site settings → Environment variables):
//   SUPABASE_URL          e.g. https://YOURPROJECT.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (NOT the anon key)

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path, opts) {
  opts = opts || {};
  const res = await fetch(SB + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({
      'apikey': KEY,
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/json'
    }, opts.headers || {}),
    body: opts.body
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!SB || !KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Supabase env vars not set' }) };

  let req;
  try { req = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }; }

  const cid = req.customerId;
  const p = req.payload || {};
  if (!cid) return { statusCode: 400, body: JSON.stringify({ error: 'missing customerId' }) };

  const ok = () => ({ statusCode: 200, body: JSON.stringify({ ok: true }) });
  const enc = encodeURIComponent;

  try {
    if (req.action === 'upsertCustomer') {
      await sb('customers?on_conflict=client_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ client_id: cid, email: p.email, name: p.name, due_date: p.due_date, updated_at: new Date().toISOString() }])
      });
      return ok();
    }

    if (req.action === 'saveKit') {
      // Customer must exist first (FK). Upsert a stub if needed.
      await sb('customers?on_conflict=client_id', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ client_id: cid }]) });
      await sb('kit_items?customer_client_id=eq.' + enc(cid), { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      const items = (p.items || []).map(i => Object.assign({ customer_client_id: cid }, i));
      if (items.length) await sb('kit_items', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(items) });
      return ok();
    }

    if (req.action === 'saveChecklists') {
      await sb('customers?on_conflict=client_id', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ client_id: cid }]) });
      await sb('checklists?customer_client_id=eq.' + enc(cid), { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      for (const l of (p.lists || [])) {
        const ins = await sb('checklists', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify([{ customer_client_id: cid, name: l.name, preset: !!l.preset }]) });
        let lid = null; try { lid = JSON.parse(ins.body)[0].id; } catch (e) {}
        const items = (l.items || []);
        if (lid && items.length) {
          await sb('checklist_items', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(items.map((it, idx) => ({ checklist_id: lid, text: it.text, done: !!it.done, note: it.note, sort_index: idx }))) });
        }
      }
      return ok();
    }

    if (req.action === 'saveChat') {
      await sb('customers?on_conflict=client_id', { method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ client_id: cid }]) });
      await sb('chats?on_conflict=client_id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ client_id: p.id, customer_client_id: cid, title: p.title, category: p.category, updated_at: new Date().toISOString() }])
      });
      await sb('messages?chat_client_id=eq.' + enc(p.id), { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      const msgs = (p.messages || []).map(m => ({ chat_client_id: p.id, role: m.role, content: m.content, sort_index: m.sort }));
      if (msgs.length) await sb('messages', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(msgs) });
      return ok();
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'unknown action' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
