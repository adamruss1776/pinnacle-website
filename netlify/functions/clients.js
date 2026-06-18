const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function indexEntry(client) {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    phone: client.phone,
    status: client.status,
    updatedAt: client.updatedAt,
  };
}

async function getIndex(store) {
  const raw = await store.get('_index');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveIndex(store, index) {
  await store.set('_index', JSON.stringify(index));
}

async function createClient(store, clientData) {
  const now = new Date().toISOString();
  const client = {
    id: crypto.randomUUID(),
    firstName: clientData.firstName || '',
    lastName: clientData.lastName || '',
    email: clientData.email || '',
    phone: clientData.phone || '',
    address: clientData.address || '',
    city: clientData.city || '',
    state: clientData.state || '',
    zip: clientData.zip || '',
    status: clientData.status || 'prospect',
    source: clientData.source || 'manual',
    salesperson: clientData.salesperson || '',
    notes: clientData.notes || '',
    vehicleInterest: {
      condition: clientData.vehicleInterest?.condition || 'either',
      makes: clientData.vehicleInterest?.makes || [],
      models: clientData.vehicleInterest?.models || [],
      yearMin: clientData.vehicleInterest?.yearMin ?? null,
      yearMax: clientData.vehicleInterest?.yearMax ?? null,
      maxMileage: clientData.vehicleInterest?.maxMileage ?? null,
      priceMin: clientData.vehicleInterest?.priceMin ?? null,
      priceMax: clientData.vehicleInterest?.priceMax ?? null,
      exteriorColor: clientData.vehicleInterest?.exteriorColor || '',
      notes: clientData.vehicleInterest?.notes || '',
    },
    createdAt: clientData.createdAt || now,
    updatedAt: now,
  };
  await store.set(client.id, JSON.stringify(client));
  return client;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const store = getStore('pinnacle-clients');
  const { httpMethod, queryStringParameters, body: rawBody } = event;
  const params = queryStringParameters || {};

  try {
    if (httpMethod === 'GET') {
      if (params.id) {
        const raw = await store.get(params.id);
        if (!raw) return respond(404, { error: 'Client not found' });
        return respond(200, JSON.parse(raw));
      }
      const index = await getIndex(store);
      return respond(200, { clients: index });
    }

    if (httpMethod === 'POST') {
      const body = JSON.parse(rawBody || '{}');

      if (Array.isArray(body.clients)) {
        const index = await getIndex(store);
        const created = [];
        for (const clientData of body.clients) {
          const client = await createClient(store, clientData);
          created.push(client);
          index.push(indexEntry(client));
        }
        await saveIndex(store, index);
        return respond(201, { clients: created });
      }

      const client = await createClient(store, body);
      const index = await getIndex(store);
      index.push(indexEntry(client));
      await saveIndex(store, index);
      return respond(201, client);
    }

    if (httpMethod === 'PUT') {
      const body = JSON.parse(rawBody || '{}');
      const { id, ...fields } = body;
      if (!id) return respond(400, { error: 'id required' });

      const raw = await store.get(id);
      if (!raw) return respond(404, { error: 'Client not found' });

      const existing = JSON.parse(raw);
      const updated = {
        ...existing,
        ...fields,
        id,
        vehicleInterest: fields.vehicleInterest
          ? { ...existing.vehicleInterest, ...fields.vehicleInterest }
          : existing.vehicleInterest,
        updatedAt: new Date().toISOString(),
      };
      await store.set(id, JSON.stringify(updated));

      const index = await getIndex(store);
      const idx = index.findIndex((c) => c.id === id);
      if (idx !== -1) {
        index[idx] = indexEntry(updated);
      } else {
        index.push(indexEntry(updated));
      }
      await saveIndex(store, index);
      return respond(200, updated);
    }

    if (httpMethod === 'DELETE') {
      const id = params.id;
      if (!id) return respond(400, { error: 'id required' });

      await store.delete(id);

      const index = await getIndex(store);
      const filtered = index.filter((c) => c.id !== id);
      await saveIndex(store, filtered);
      return respond(200, { success: true });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
