exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { text, voice } = JSON.parse(event.body || '{}');
  if (!text || !voice) {
    return { statusCode: 400, body: 'Missing text or voice' };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'ElevenLabs key not configured' };
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
    })
  });

  if (!response.ok) {
    return { statusCode: response.status, body: 'ElevenLabs error' };
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
};
