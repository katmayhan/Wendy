# Deploying Wendy (live AI) to Netlify

Wendy now talks to the real Claude API. In the Claude artifact preview she works automatically. To make her work on your own Netlify site, you deploy these files **together** and add your API key.

## Files
```
index.html                 ← the app
netlify.toml               ← config + /api/chat redirect
netlify/functions/chat.js  ← serverless proxy (hides your API key)
```

## Steps
1. Get an Anthropic API key at console.anthropic.com → API Keys. Set a small monthly spend limit to start (e.g. £20).
2. Put the three files above in one folder (keep the `netlify/functions/` structure).
3. Deploy:
   - **Drag & drop:** zip the folder and drop it on app.netlify.com (functions deploy automatically), **or**
   - **Git (recommended):** push the folder to a GitHub repo and "Import from Git" in Netlify. No build command needed.
4. In Netlify → Site settings → **Environment variables**, add:
   - `ANTHROPIC_API_KEY` = your key
5. Redeploy. Done — the chat now calls `/api/chat`, which the function proxies to Anthropic with your key.

## How it works
- The browser sends the conversation to `/api/chat`.
- `chat.js` forwards it to Anthropic using your secret key, and returns the reply.
- Your key is never exposed to the browser.

## Notes
- This wires up the **text chat** to live AI. The **voice call** still uses scripted lines + browser speech for now; hooking voice to live AI (speech-to-text → Claude → text-to-speech / ElevenLabs) is a further step.
- Accounts/sign-in are still a front-end prototype (no real auth yet). Real accounts + saved kit lists are the Supabase step from your plan.
- Product data (the 4 prams) is demo data in `index.html`. Swap in your real catalogue when ready.
