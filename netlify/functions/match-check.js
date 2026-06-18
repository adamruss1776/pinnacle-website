const { getStore } = require('@netlify/blobs');
const { STORES } = require('./inventory-scraper');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function vehicleMatchesPreferences(vehicle, prefs) {
  if (!prefs) return false;

  if (prefs.condition && prefs.condition !== 'either') {
    if (vehicle.condition !== prefs.condition) return false;
  }

  if (Array.isArray(prefs.makes) && prefs.makes.length > 0) {
    const vMake = (vehicle.make || '').toLowerCase();
    const matched = prefs.makes.some((m) => vMake.includes(m.toLowerCase()) || m.toLowerCase().includes(vMake));
    if (!matched) return false;
  }

  if (Array.isArray(prefs.models) && prefs.models.length > 0) {
    const vModel = (vehicle.model || '').toLowerCase();
    const matched = prefs.models.some((m) => vModel.includes(m.toLowerCase()) || m.toLowerCase().includes(vModel));
    if (!matched) return false;
  }

  if (prefs.yearMin != null) {
    if (parseInt(vehicle.year, 10) < prefs.yearMin) return false;
  }

  if (prefs.yearMax != null) {
    if (parseInt(vehicle.year, 10) > prefs.yearMax) return false;
  }

  if (prefs.maxMileage != null && vehicle.condition === 'used') {
    if ((vehicle.mileage || 0) > prefs.maxMileage) return false;
  }

  if (prefs.priceMax != null && vehicle.price != null) {
    if (vehicle.price > prefs.priceMax) return false;
  }

  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let preferences;
  try {
    const body = JSON.parse(event.body || '{}');
    preferences = body.preferences;
    if (!preferences || typeof preferences !== 'object') {
      return respond(400, { error: 'preferences object required' });
    }
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const inventoryStore = getStore('pinnacle-inventory');
  const matches = [];

  const allStoreIds = [...STORES.map(s => s.id), 'own-store'];

  await Promise.all(
    allStoreIds.map(async (storeId) => {
      try {
        const raw = await inventoryStore.get(`${storeId}/latest`);
        if (!raw) return;
        const { vehicles } = JSON.parse(raw);
        if (!Array.isArray(vehicles)) return;
        for (const vehicle of vehicles) {
          if (vehicleMatchesPreferences(vehicle, preferences)) {
            matches.push(vehicle);
          }
        }
      } catch {}
    })
  );

  matches.sort((a, b) => {
    if (a.price != null && b.price != null) return a.price - b.price;
    if (a.price != null) return -1;
    if (b.price != null) return 1;
    return 0;
  });

  return respond(200, { matches, count: matches.length });
};
