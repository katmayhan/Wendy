// Netlify serverless function: proxies chat requests to the Anthropic API.
// The browser never sees your API key — it lives in the ANTHROPIC_API_KEY env var.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: event.body
    });
    const data = await resp.text();
    return {
      statusCode: resp.status,
      headers: { 'Content-Type': 'application/json' },
      body: data
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Proxy error' }) };
  }
};
