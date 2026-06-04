// Netlify function: receives a WAV/WebM audio blob, sends to OpenAI Whisper, returns transcript.
// Env var: OPENAI_API_KEY

const KEY = process.env.OPENAI_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set' }) };

  try {
    // Body is base64-encoded audio
    const audioBuffer = Buffer.from(event.body, 'base64');
    const contentType = event.headers['x-audio-type'] || 'audio/webm';
    const ext = contentType.includes('wav') ? 'wav' : contentType.includes('mp4') ? 'mp4' : 'webm';

    // Build multipart form manually (no FormData in Node serverless)
    const boundary = '----WendyBoundary' + Date.now();
    const CRLF = '\r\n';

    const header = Buffer.from(
      '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="file"; filename="audio.' + ext + '"' + CRLF +
      'Content-Type: ' + contentType + CRLF + CRLF
    );
    const modelPart = Buffer.from(
      CRLF + '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="model"' + CRLF + CRLF +
      'whisper-1' +
      CRLF + '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="language"' + CRLF + CRLF +
      'en' +
      CRLF + '--' + boundary + '--' + CRLF
    );

    const body = Buffer.concat([header, audioBuffer, modelPart]);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      },
      body: body
    });

    if (!res.ok) {
      const t = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: t }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: data.text || '' })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
