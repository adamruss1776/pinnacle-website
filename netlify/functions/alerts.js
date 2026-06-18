const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json',
};

const MAX_ALERTS = 100;

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function getAlerts(store) {
  const raw = await store.get('recent');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveAlerts(store, alerts) {
  await store.set('recent', JSON.stringify(alerts));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const store = getStore('pinnacle-alerts');
  const { httpMethod, body: rawBody } = event;

  try {
    if (httpMethod === 'GET') {
      const alerts = await getAlerts(store);
      const unread = alerts.filter((a) => !a.read).length;
      return respond(200, { alerts, unread });
    }

    if (httpMethod === 'PUT') {
      const body = JSON.parse(rawBody || '{}');
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const idSet = new Set(ids);

      const alerts = await getAlerts(store);
      const updated = alerts.map((a) =>
        idSet.has(a.id) ? { ...a, read: true } : a
      );
      await saveAlerts(store, updated);
      return respond(200, { success: true });
    }

    if (httpMethod === 'POST') {
      const body = JSON.parse(rawBody || '{}');
      const alert = body.alert || body;

      const newAlert = {
        id: alert.id || crypto.randomUUID(),
        type: alert.type || 'new_inventory',
        clientId: alert.clientId ?? null,
        clientName: alert.clientName ?? null,
        vehicle: {
          vin: alert.vehicle?.vin || '',
          make: alert.vehicle?.make || '',
          model: alert.vehicle?.model || '',
          year: alert.vehicle?.year || '',
          price: alert.vehicle?.price ?? null,
          mileage: alert.vehicle?.mileage ?? null,
          condition: alert.vehicle?.condition || '',
          storeName: alert.vehicle?.storeName || '',
          detailUrl: alert.vehicle?.detailUrl || '',
        },
        storeId: alert.storeId || '',
        storeName: alert.storeName || '',
        read: false,
        createdAt: alert.createdAt || new Date().toISOString(),
      };

      const alerts = await getAlerts(store);
      alerts.unshift(newAlert);
      const trimmed = alerts.slice(0, MAX_ALERTS);
      await saveAlerts(store, trimmed);
      return respond(201, newAlert);
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
