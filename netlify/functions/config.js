// Returns the public Supabase keys to the frontend.
// These are the ANON/PUBLIC keys only — safe to expose.
// The service_role key never leaves the server.

exports.handler = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configured: false })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    },
    body: JSON.stringify({ configured: true, url, key })
  };
};
