// api/scan.js
export default async function handler(req, res) {
  // Securely handle incoming pre-flight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  // Look for Vercel system variable first, fall back to manual override header if missing
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key-override'];

  if (!apiKey || apiKey.trim() === "") {
    return res.status(400).json({
      error: { 
        message: 'Backend Configuration Error: No Anthropic API Key found. Ensure ANTHROPIC_API_KEY is configured for Production/Preview environments in Vercel.' 
      }
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // If Anthropic rejects the key or payload, forward their exact error message text
    if (!response.ok) {
      return res.status(response.status).json({
        error: { message: data.error?.message || `Anthropic API rejected request with status ${response.status}` }
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: { message: 'Internal Vercel Serverless Error: ' + error.message }
    });
  }
}
