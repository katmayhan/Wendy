# Wendy — Auth & Environment Setup

## 1. Supabase — get your keys

1. Go to your Supabase project → **Project Settings → API**
2. Copy:
   - **Project URL** (e.g. `https://grczjxrpjhzgnmz.supabase.co`)
   - **anon public** key
   - **service_role** key (keep this secret — Netlify only)

## 2. Netlify — set environment variables

Go to **Netlify → Site configuration → Environment variables** and add:

| Variable | Value | Used by |
|---|---|---|
| `SUPABASE_URL` | Your project URL | `db.js` function |
| `SUPABASE_ANON_KEY` | Your anon/public key | Frontend (injected at build) |
| `SUPABASE_SERVICE_KEY` | Your service_role key | `db.js` function |
| `ANTHROPIC_API_KEY` | Your Anthropic key | `chat.js` function |
| `ELEVENLABS_API_KEY` | Your ElevenLabs key | `tts.js` function |
| `ELEVENLABS_VOICE_ID` | (optional) your preferred voice ID | `tts.js` function |

## 3. Inject Supabase keys into the frontend

The frontend needs the public URL and anon key. Add a **build snippet** in Netlify:

Go to **Netlify → Site configuration → Build & deploy → Post processing → Snippet injection**

Add a **"Before </head>"** snippet:
```html
<script>
  window.__SUPABASE_URL__ = 'YOUR_SUPABASE_URL';
  window.__SUPABASE_ANON_KEY__ = 'YOUR_ANON_KEY';
</script>
```

Replace both values with your actual Supabase credentials.

## 4. Enable Google Auth in Supabase (optional)

1. Supabase → **Authentication → Providers → Google**
2. Enable it and follow the Google Cloud Console steps
3. Set the redirect URL to: `https://your-netlify-site.netlify.app`

## 5. ElevenLabs voice

The default voice is **Charlotte** (voice ID: `XB0fDUnXU5powFXDhCwa`) — a warm, natural British female voice.

To use a different voice:
1. Go to [elevenlabs.io](https://elevenlabs.io) → your voice library
2. Copy the Voice ID
3. Set `ELEVENLABS_VOICE_ID` in Netlify env vars

## 6. Run the schema

In Supabase → **SQL Editor**, run `supabase-schema.sql` to create the tables.
