// GET — fetches live vehicle inventory from CDK Global via OAuth 2.0
// Required env vars: CDK_CLIENT_ID, CDK_CLIENT_SECRET
// Optional env vars:
//   CDK_TOKEN_URL      (default: https://account.cdk.com/oauth2/v1/token)
//   CDK_INVENTORY_URL  (default: https://api.cdk.com/inventory/v1/vehicles)
//   CDK_SUBSCRIPTION_ID (required for Fortellis-routed subscriptions)
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { CDK_CLIENT_ID, CDK_CLIENT_SECRET, CDK_TOKEN_URL, CDK_INVENTORY_URL, CDK_SUBSCRIPTION_ID } = process.env;

  if (!CDK_CLIENT_ID || !CDK_CLIENT_SECRET) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CDK credentials not configured', configured: false })
    };
  }

  try {
    const token = await getCDKToken(CDK_TOKEN_URL, CDK_CLIENT_ID, CDK_CLIENT_SECRET);
    const vehicles = await getCDKInventory(CDK_INVENTORY_URL, token, CDK_SUBSCRIPTION_ID);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ vehicles, count: vehicles.length })
    };
  } catch (err) {
    console.error('CDK inventory error:', err.message);
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};

async function getCDKToken(tokenUrl, clientId, clientSecret) {
  const url = tokenUrl || 'https://account.cdk.com/oauth2/v1/token';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=inventory:read'
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CDK auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('CDK returned no access token');
  return data.access_token;
}

async function getCDKInventory(inventoryUrl, token, subscriptionId) {
  const url = inventoryUrl || 'https://api.cdk.com/inventory/v1/vehicles';
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (subscriptionId) headers['Subscription-Id'] = subscriptionId;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CDK inventory fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  // CDK responses vary by integration version — normalize common shapes
  const items = data.items || data.vehicles || data.data || [];
  return items.map(v => ({
    vin: v.vin || v.VIN || v.vehicleIdentificationNumber || '',
    make: v.make || v.Make || '',
    model: v.model || v.Model || '',
    year: String(v.year || v.modelYear || v.Year || ''),
    stockNumber: v.stockNumber || v.stock || v.StockNumber || '',
    trim: v.trim || v.Trim || '',
    exteriorColor: v.exteriorColor || v.color || v.Color || '',
    price: v.price || v.listPrice || v.Price || null
  })).filter(v => v.vin);
}
