// Netlify serverless function: turns Wendy's text into natural speech via ElevenLabs.
// The ElevenLabs key stays server-side (never in the browser).
//
// Env vars (Netlify → Site settings → Environment variables):
//   ELEVENLABS_API_KEY   your ElevenLabs API key  (required)
//   ELEVENLABS_VOICE_ID  a voice id from your ElevenLabs library (optional;
//                        defaults to Charlotte — British female, natural and warm)

const KEY = process.env.ELEVENLABS_API_KEY;
// Charlotte — a warm, natural British female voice. Replace with your preferred voice ID.
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'XB0fDUnXU5powFXDhCwa';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!KEY) return { statusCode: 500, body: 'ELEVENLABS_API_KEY not set' };

  let text = '';
  try { text = (JSON.parse(event.body || '{}').text || '').slice(0, 800); } catch (e) {}
  if (!text) return { statusCode: 400, body: 'no text' };

  try {
    const res = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE,
      {
        method: 'POST',
        headers: {
          'xi-api-key': KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.80,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!res.ok) {
      const t = await res.text();
      console.error('ElevenLabs error:', res.status, t);
      return { statusCode: res.status, body: t };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) {
      return { statusCode: 500, body: 'Empty audio response from ElevenLabs' };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    console.error('TTS error:', e);
    return { statusCode: 500, body: String(e) };
  }
};
