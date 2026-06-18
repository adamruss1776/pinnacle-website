const { getStore } = require('@netlify/blobs');
const { scrapeStore, STORES } = require('./inventory-scraper');

const MAX_ALERTS = 100;
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

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

async function sendEmailSummary(newVehicles, clientMatches) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const toEmail = process.env.RECALL_ALERT_EMAIL;
  if (!apiKey || !toEmail) return;

  const vehicleLines = newVehicles.map(
    (v) => `${v.year} ${v.make} ${v.model} — ${v.storeName} (VIN: ${v.vin})`
  ).join('\n');

  const matchLines = clientMatches.map(
    (m) => `${m.clientName}: ${m.vehicle.year} ${m.vehicle.make} ${m.vehicle.model} at ${m.vehicle.storeName}`
  ).join('\n');

  const text = [
    `Jessica Daily Scan — ${new Date().toDateString()}`,
    '',
    `New Vehicles: ${newVehicles.length}`,
    vehicleLines || '(none)',
    '',
    `Client Matches: ${clientMatches.length}`,
    matchLines || '(none)',
  ].join('\n');

  await fetch(SENDGRID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: toEmail },
      subject: `Pinnacle Daily Scan — ${newVehicles.length} new vehicles, ${clientMatches.length} client matches`,
      content: [{ type: 'text/plain', value: text }],
    }),
  }).catch(() => {});
}

exports.handler = async () => {
  const inventoryStore = getStore('pinnacle-inventory');
  const clientsStore = getStore('pinnacle-clients');
  const alertsStore = getStore('pinnacle-alerts');
  const today = new Date().toISOString().slice(0, 10);

  const allNewVehicles = [];
  const clientMatches = [];
  const newAlerts = [];

  for (const store of STORES) {
    let yesterday = { vehicles: [] };
    try {
      const raw = await inventoryStore.get(`${store.id}/latest`);
      if (raw) yesterday = JSON.parse(raw);
    } catch {}

    let todayResult;
    try {
      todayResult = await scrapeStore(store);
    } catch (err) {
      todayResult = { storeId: store.id, name: store.name, vehicles: [], scrapedAt: new Date().toISOString() };
    }

    try {
      const payload = JSON.stringify({ vehicles: todayResult.vehicles, scrapedAt: todayResult.scrapedAt });
      await inventoryStore.set(`${store.id}/latest`, payload);
      await inventoryStore.set(`${store.id}/${today}`, payload);
    } catch {}

    const yesterdayVins = new Set((yesterday.vehicles || []).map((v) => v.vin));
    const newVehicles = todayResult.vehicles.filter((v) => v.vin && !yesterdayVins.has(v.vin));
    allNewVehicles.push(...newVehicles);

    for (const vehicle of newVehicles) {
      newAlerts.push({
        id: crypto.randomUUID(),
        type: 'new_inventory',
        clientId: null,
        clientName: null,
        vehicle: {
          vin: vehicle.vin,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          price: vehicle.price,
          mileage: vehicle.mileage,
          condition: vehicle.condition,
          storeName: vehicle.storeName,
          detailUrl: vehicle.detailUrl,
        },
        storeId: store.id,
        storeName: store.name,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  }

  let clients = [];
  try {
    const raw = await clientsStore.get('_index');
    if (raw) clients = JSON.parse(raw);
  } catch {}

  const activeClients = clients.filter((c) => c.status === 'active' || c.status === 'prospect');

  for (const vehicle of allNewVehicles) {
    for (const clientEntry of activeClients) {
      let fullClient;
      try {
        const raw = await clientsStore.get(clientEntry.id);
        if (!raw) continue;
        fullClient = JSON.parse(raw);
      } catch { continue; }

      if (vehicleMatchesPreferences(vehicle, fullClient.vehicleInterest)) {
        const clientName = `${fullClient.firstName} ${fullClient.lastName}`.trim();
        clientMatches.push({ clientName, clientId: fullClient.id, vehicle });
        newAlerts.push({
          id: crypto.randomUUID(),
          type: 'client_match',
          clientId: fullClient.id,
          clientName,
          vehicle: {
            vin: vehicle.vin,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            price: vehicle.price,
            mileage: vehicle.mileage,
            condition: vehicle.condition,
            storeName: vehicle.storeName,
            detailUrl: vehicle.detailUrl,
          },
          storeId: vehicle.storeId,
          storeName: vehicle.storeName,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  if (newAlerts.length > 0) {
    try {
      let existing = [];
      const raw = await alertsStore.get('recent');
      if (raw) existing = JSON.parse(raw);
      const combined = [...newAlerts, ...existing].slice(0, MAX_ALERTS);
      await alertsStore.set('recent', JSON.stringify(combined));
    } catch {}
  }

  await sendEmailSummary(allNewVehicles, clientMatches);

  return {
    statusCode: 200,
    body: JSON.stringify({
      newVehicles: allNewVehicles.length,
      clientMatches: clientMatches.length,
      alertsCreated: newAlerts.length,
      scannedAt: new Date().toISOString(),
    }),
  };
};
