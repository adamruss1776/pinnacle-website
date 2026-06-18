const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

const FIELD_ALIASES = {
  vin:           ['vin', 'vehicle identification number', 'vehicleidentificationnumber', 'vehicle id', 'vin number'],
  year:          ['year', 'model year', 'modelyear', 'yr', 'my', 'year model'],
  make:          ['make', 'manufacturer', 'mfr'],
  model:         ['model', 'model name', 'modelname'],
  trim:          ['trim', 'trim level', 'trimlevel', 'trim/series', 'series', 'sub model'],
  mileage:       ['mileage', 'miles', 'odometer', 'odometer reading', 'odometerreading', 'current mileage', 'actual mileage'],
  price:         ['price', 'internet price', 'internetprice', 'sale price', 'saleprice', 'list price', 'listprice', 'asking price', 'retail price', 'msrp', 'selling price', 'our price', 'final price'],
  stockNumber:   ['stock', 'stock number', 'stocknumber', 'stock #', 'stock#', 'stockno', 'stock no', 'stk', 'stk #'],
  condition:     ['type', 'condition', 'new/used', 'newused', 'vehicle type', 'status', 'new used'],
  exteriorColor: ['exterior color', 'exteriorcolor', 'color', 'ext color', 'extcolor', 'exterior', 'ext. color', 'outside color'],
  interiorColor: ['interior color', 'interiorcolor', 'int color', 'intcolor', 'interior', 'int. color', 'inside color'],
  bodyStyle:     ['body style', 'bodystyle', 'body', 'class', 'style', 'body type', 'category'],
  imageUrl:      ['image', 'image url', 'imageurl', 'photo', 'photo url', 'thumbnail', 'image link'],
  detailUrl:     ['url', 'link', 'detail url', 'detailurl', 'vehicle url', 'page url', 'detail page'],
};

function normalizeHeader(h) {
  return h.toLowerCase().trim().replace(/[^a-z0-9 /]/g, '').trim();
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
    } else if (c === delimiter && !inQ) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',';

  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  const colIdx = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      if (aliases.includes(headers[i])) {
        colIdx[field] = i;
        break;
      }
    }
  }

  if (colIdx.vin === undefined) return [];

  const scrapedAt = new Date().toISOString();
  const vehicles = [];

  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r], delimiter);
    const vin = (cells[colIdx.vin] || '').trim().toUpperCase();
    if (!vin || vin.length !== 17) continue;

    const get = (field) =>
      colIdx[field] !== undefined ? (cells[colIdx[field]] || '').trim() : '';
    const getNum = (field) => {
      const v = parseFloat(get(field).replace(/[$,]/g, ''));
      return isNaN(v) ? null : v;
    };

    const condRaw = get('condition').toLowerCase();
    const condition = condRaw.includes('used') || condRaw.includes('pre') ? 'used' : 'new';

    vehicles.push({
      vin,
      year: get('year'),
      make: get('make'),
      model: get('model'),
      trim: get('trim'),
      mileage: getNum('mileage') != null ? Math.round(getNum('mileage')) : null,
      price: getNum('price'),
      stockNumber: get('stockNumber'),
      condition,
      exteriorColor: get('exteriorColor'),
      interiorColor: get('interiorColor'),
      bodyStyle: get('bodyStyle'),
      imageUrl: get('imageUrl'),
      detailUrl: get('detailUrl'),
      storeId: 'own-store',
      storeName: 'My Dealership',
      scrapedAt,
    });
  }

  return vehicles;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let csv, vehicles;
  try {
    const body = JSON.parse(event.body || '{}');
    csv = body.csv;
    vehicles = body.vehicles;
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  if (csv) {
    vehicles = parseCSV(csv);
    if (vehicles.length === 0) {
      return respond(400, { error: 'No valid vehicles found in CSV — ensure a VIN column exists with 17-character values.' });
    }
  } else if (!Array.isArray(vehicles) || vehicles.length === 0) {
    return respond(400, { error: 'Provide csv text or vehicles array' });
  }

  const scrapedAt = new Date().toISOString();
  const dateStr = scrapedAt.slice(0, 10);

  // Stamp each vehicle with upload time if not already set
  vehicles = vehicles.map(v => ({ ...v, storeId: v.storeId || 'own-store', storeName: v.storeName || 'My Dealership', scrapedAt: v.scrapedAt || scrapedAt }));

  const payload = JSON.stringify({ vehicles, scrapedAt });
  const inventoryStore = getStore('pinnacle-inventory');
  await inventoryStore.set('own-store/latest', payload);
  await inventoryStore.set(`own-store/${dateStr}`, payload);

  return respond(200, { count: vehicles.length, savedAt: scrapedAt });
};

exports.parseCSV = parseCSV;
