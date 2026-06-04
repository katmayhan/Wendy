// Netlify serverless function: turns Wendy's text into natural speech via ElevenLabs.
// The ElevenLabs key stays server-side (never in the browser).
//
// Env vars (Netlify → Site settings → Environment variables):
//   ELEVENLABS_API_KEY   your ElevenLabs API key  (required)
//   ELEVENLABS_VOICE_ID  a voice id from your ElevenLabs library (optional;
//                        defaults to a preset voice). Pick a British female
//                        voice in ElevenLabs and paste its Voice ID here.

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // default preset

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!KEY) return { statusCode: 500, body: 'ELEVENLABS_API_KEY not set' };

  let text = '';
  try { text = (JSON.parse(event.body || '{}').text || '').slice(0, 800); } catch (e) {}
  if (!text) return { statusCode: 400, body: 'no text' };

  try {
    const res = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE + '?output_format=mp3_44100_128',
      {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );
    if (!res.ok) {
      const t = await res.text();
      return { statusCode: res.status, body: t };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
