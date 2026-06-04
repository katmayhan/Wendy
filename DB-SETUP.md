# Wendy database setup (Supabase)

This stores your **customer records** and **every Wendy chat**, plus each customer's kit list and checklists. It's wired so the app keeps working locally even before the database exists — once you set the env vars and deploy, data also persists to Supabase.

## What gets stored
- **customers** — one row per parent: email, name, due date, marketing opt-in.
- **chats** + **messages** — every conversation (general or per-category) and each message in it.
- **kit_items** — the customer's kit list: category, chosen product, and whether they're renting or buying.
- **checklists** + **checklist_items** — hospital bag, newborn essentials and any custom lists, with ticks and notes.

## Setup (about 10 minutes)
1. Create a project at supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase-schema.sql`, and run it. That creates all the tables.
3. In Supabase → **Project Settings → API**, copy:
   - the **Project URL** (e.g. `https://abcd.supabase.co`)
   - the **service_role** key (under Project API keys — *not* the anon key)
4. In Netlify → **Site settings → Environment variables**, add:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_KEY` = the service_role key
   - `ANTHROPIC_API_KEY` = your Anthropic key (for the live AI)
5. Make sure these files deploy together: `index.html`, `netlify.toml`, `netlify/functions/chat.js`, `netlify/functions/db.js`.
6. Redeploy. Done — the app now writes to Supabase as people use it.

## How it works
- The browser never sees the service key. The app POSTs to `/api/db`, and the Netlify function (`db.js`) writes to Supabase server-side using the service-role key.
- Each customer currently gets an **anonymous id** stored on their device (`wendy-cid`). That ties their chats, kit and checklists together without a login yet.
- The schema already includes `auth_user_id` and Row Level Security so you can drop in **Supabase Auth** (real email/Google login) next — at which point you set `auth_user_id` on sign-up and add RLS policies (commented at the bottom of the schema) so each person can only see their own data.

## Privacy note
You're now storing personal data (emails, due dates, conversations). Before going live for real, add real authentication, the RLS policies, and make sure your privacy policy covers what's collected and why — worth a quick check given Baboodle's FCA status.

## Next step (optional)
Right now the app *writes* to the database. To also *read it back* across devices (so a customer signing in on a new phone sees their kit list), add a `hydrate` action to `db.js` that returns the customer's rows, and call it on load — that pairs naturally with adding Supabase Auth.
