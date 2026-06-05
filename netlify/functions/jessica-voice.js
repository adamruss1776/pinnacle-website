const https = require("https");

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }

  const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
  const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID;
  if (!ELEVEN_KEY) return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Voice API key not configured" }) };

  const { text } = JSON.parse(event.body);
  const payload = JSON.stringify({ text, model_id: "eleven_monolingual_v1", voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true } });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${ELEVEN_VOICE}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": ELEVEN_KEY, "Content-Length": Buffer.byteLength(payload) }
    }, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: 200,
          headers: { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*" },
          body: buffer.toString("base64"),
          isBase64Encoded: true
        });
      });
    });
    req.on("error", (err) => resolve({ statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: err.message }) }));
    req.write(payload);
    req.end();
  });
};
