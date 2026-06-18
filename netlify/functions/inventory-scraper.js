const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const STORES = [
  { id: 'rrmc-chicago', name: 'Rolls-Royce Motor Cars Chicago', url: 'https://www.rrmc-chicago.com', make: 'Rolls-Royce', inventoryPaths: ['/inventory/', '/new/', '/new-vehicles/', '/pre-owned/'] },
  { id: 'lamborghini-dg', name: 'Lamborghini Downers Grove', url: 'https://www.lamborghinidownersgrove.com', make: 'Lamborghini', inventoryPaths: ['/inventory/', '/new-vehicles/', '/new/', '/vehicles/'] },
  { id: 'lamborghini-seattle', name: 'Lamborghini of Seattle', url: 'https://www.lamborghiniofseattle.com', make: 'Lamborghini', inventoryPaths: ['/inventory/', '/new-vehicles/', '/new/', '/vehicles/'] },
  { id: 'rrmc-seattle', name: 'Rolls-Royce Motor Cars Seattle', url: 'https://www.rolls-roycemotorcarsseattle.com', make: 'Rolls-Royce', inventoryPaths: ['/inventory/', '/new/', '/new-vehicles/', '/pre-owned/'] },
  { id: 'bentley-dg', name: 'Bentley Downers Grove', url: 'https://www.bentleydownersgrove.com', make: 'Bentley', inventoryPaths: ['/inventory/', '/new-vehicles/', '/new/', '/vehicles/'] },
  { id: 'bentley-gc', name: 'Bentley Gold Coast', url: 'https://www.bentleygoldcoast.com', make: 'Bentley', inventoryPaths: ['/inventory/', '/new-vehicles/', '/new/', '/vehicles/'] },
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const VIN_PATTERN = /[A-HJ-NPR-Z0-9]{17}/g;
const VEHICLE_ARRAY_KEYS = ['vehicles', 'inventory', 'listings', 'cars', 'items', 'results', 'data'];

function normalizeVehicle(raw, storeId, storeName, make, scrapedAt) {
  const vin = (raw.vin || raw.VIN || raw.Vin || '').toString().trim().toUpperCase();
  if (!vin || vin.length !== 17) return null;

  const price = parseFloat(raw.price || raw.Price || raw.listPrice || raw.salePrice || raw.msrp || raw.MSRP || 0) || null;
  const mileage = parseInt(raw.mileage || raw.Mileage || raw.miles || raw.Miles || 0, 10) || null;
  const year = (raw.year || raw.Year || raw.modelYear || raw.ModelYear || '').toString().trim();
  const conditionRaw = (raw.condition || raw.Condition || raw.type || raw.Type || '').toString().toLowerCase();
  const condition = conditionRaw.includes('used') || conditionRaw.includes('pre') ? 'used' : 'new';

  return {
    vin,
    make: (raw.make || raw.Make || make || '').toString().trim(),
    model: (raw.model || raw.Model || '').toString().trim(),
    year,
    trim: (raw.trim || raw.Trim || raw.trimLevel || '').toString().trim(),
    price,
    mileage,
    condition,
    exteriorColor: (raw.exteriorColor || raw.ExteriorColor || raw.color || raw.Color || raw.ext_color || '').toString().trim(),
    interiorColor: (raw.interiorColor || raw.InteriorColor || raw.int_color || '').toString().trim(),
    stockNumber: (raw.stockNumber || raw.StockNumber || raw.stock || raw.Stock || raw.stockNum || '').toString().trim(),
    imageUrl: (raw.imageUrl || raw.ImageUrl || raw.image || raw.photo || raw.primaryPhoto || raw.thumbnail || '').toString().trim(),
    detailUrl: (raw.detailUrl || raw.DetailUrl || raw.url || raw.link || raw.vehicleUrl || '').toString().trim(),
    storeId,
    storeName,
    scrapedAt,
  };
}

function walkForVehicles(obj, storeId, storeName, make, scrapedAt, depth = 0) {
  if (depth > 8 || obj === null || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      const first = obj[0];
      if (first.vin || first.VIN || first.Vin) {
        return obj
          .map((v) => normalizeVehicle(v, storeId, storeName, make, scrapedAt))
          .filter(Boolean);
      }
    }
    const results = [];
    for (const item of obj) {
      results.push(...walkForVehicles(item, storeId, storeName, make, scrapedAt, depth + 1));
    }
    return results;
  }
  for (const key of VEHICLE_ARRAY_KEYS) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) {
      const found = walkForVehicles(obj[key], storeId, storeName, make, scrapedAt, depth + 1);
      if (found.length > 0) return found;
    }
  }
  const results = [];
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null) {
      results.push(...walkForVehicles(val, storeId, storeName, make, scrapedAt, depth + 1));
    }
  }
  return results;
}

function extractFromNextData(html, storeId, storeName, make, scrapedAt) {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
    || html.match(/<script[^>]+type="application\/json"[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]);
    return walkForVehicles(data, storeId, storeName, make, scrapedAt);
  } catch { return []; }
}

function extractFromWindowVars(html, storeId, storeName, make, scrapedAt) {
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*(?:window\.|<\/script>)/,
    /window\.inventoryData\s*=\s*({[\s\S]*?});?\s*(?:window\.|<\/script>)/,
    /window\.initialInventory\s*=\s*({[\s\S]*?});?\s*(?:window\.|<\/script>)/,
    /window\._inventory\s*=\s*(\[[\s\S]*?\]);?\s*(?:window\.|<\/script>)/,
    /window\.DDC\s*=\s*({[\s\S]*?});?\s*(?:window\.|<\/script>)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const found = walkForVehicles(data, storeId, storeName, make, scrapedAt);
        if (found.length > 0) return found;
      } catch { continue; }
    }
  }
  return [];
}

function extractFromLdJson(html, storeId, storeName, make, scrapedAt) {
  const scriptRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const results = [];
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Car') {
          const v = normalizeVehicle({
            vin: item.vehicleIdentificationNumber,
            make: item.brand?.name || item.brand || make,
            model: item.model,
            year: item.modelDate || item.vehicleModelDate,
            price: item.offers?.price,
            mileage: item.mileageFromOdometer?.value || item.mileageFromOdometer,
            condition: item.itemCondition?.includes('Used') ? 'used' : 'new',
            exteriorColor: item.color,
            detailUrl: item.url,
            imageUrl: Array.isArray(item.image) ? item.image[0] : item.image,
          }, storeId, storeName, make, scrapedAt);
          if (v) results.push(v);
        } else if (item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
          for (const el of item.itemListElement) {
            const entry = el.item || el;
            if (entry['@type'] === 'Car') {
              const v = normalizeVehicle({
                vin: entry.vehicleIdentificationNumber,
                make: entry.brand?.name || entry.brand || make,
                model: entry.model,
                year: entry.modelDate || entry.vehicleModelDate,
                price: entry.offers?.price,
                condition: entry.itemCondition?.includes('Used') ? 'used' : 'new',
                exteriorColor: entry.color,
                detailUrl: entry.url,
                imageUrl: Array.isArray(entry.image) ? entry.image[0] : entry.image,
              }, storeId, storeName, make, scrapedAt);
              if (v) results.push(v);
            }
          }
        }
      }
    } catch { continue; }
  }
  return results;
}

function extractVinsGeneric(html, storeId, storeName, make, scrapedAt) {
  const vins = [...new Set(html.match(VIN_PATTERN) || [])];
  return vins.map((vin) => ({
    vin,
    make,
    model: '',
    year: '',
    trim: '',
    price: null,
    mileage: null,
    condition: 'new',
    exteriorColor: '',
    interiorColor: '',
    stockNumber: '',
    imageUrl: '',
    detailUrl: '',
    storeId,
    storeName,
    scrapedAt,
  }));
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json,*/*' },
      signal: controller.signal,
    });
    const text = await res.text();
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeStore(store) {
  const scrapedAt = new Date().toISOString();
  const { id: storeId, name: storeName, url: baseUrl, make, inventoryPaths } = store;

  for (const path of inventoryPaths) {
    const url = baseUrl + path;
    let html;
    try {
      html = await fetchWithTimeout(url);
    } catch {
      continue;
    }

    let vehicles = extractFromNextData(html, storeId, storeName, make, scrapedAt);
    if (vehicles.length > 0) return { storeId, name: storeName, vehicles, scrapedAt };

    vehicles = extractFromWindowVars(html, storeId, storeName, make, scrapedAt);
    if (vehicles.length > 0) return { storeId, name: storeName, vehicles, scrapedAt };

    vehicles = extractFromLdJson(html, storeId, storeName, make, scrapedAt);
    if (vehicles.length > 0) return { storeId, name: storeName, vehicles, scrapedAt };

    vehicles = extractVinsGeneric(html, storeId, storeName, make, scrapedAt);
    if (vehicles.length > 0) return { storeId, name: storeName, vehicles, scrapedAt };
  }

  return { storeId, name: storeName, vehicles: [], scrapedAt };
}

async function saveSnapshot(blobStore, storeId, vehicles, scrapedAt) {
  const dateStr = scrapedAt.slice(0, 10);
  const payload = JSON.stringify({ vehicles, scrapedAt });
  await blobStore.set(`${storeId}/latest`, payload);
  await blobStore.set(`${storeId}/${dateStr}`, payload);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const blobStore = getStore('pinnacle-inventory');
  const scannedAt = new Date().toISOString();

  try {
    let storeList = STORES;
    if (params.store) {
      const target = STORES.find((s) => s.id === params.store);
      if (!target) return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Store not found' }) };
      storeList = [target];
    }

    const results = await Promise.all(
      storeList.map(async (store) => {
        try {
          const result = await scrapeStore(store);
          await saveSnapshot(blobStore, result.storeId, result.vehicles, result.scrapedAt);
          return result;
        } catch (err) {
          return { storeId: store.id, name: store.name, vehicles: [], error: err.message };
        }
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ stores: results, scannedAt }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

exports.scrapeStore = scrapeStore;
exports.STORES = STORES;
