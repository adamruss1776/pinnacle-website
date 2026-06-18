const { getStore } = require('@netlify/blobs');
const { scrapeStore, STORES } = require('./inventory-scraper');

const MAX_ALERTS = 100;

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

async function sendEmail(toEmail, subject, html) {
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!resendKey && !sendgridKey) return;

  if (resendKey) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Pinnacle CRM <onboarding@resend.dev>',
        to: [toEmail],
        subject,
        html,
      }),
    }).catch(() => {});
    return;
  }

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: 'alerts@pinnacle-crm.com', name: 'Pinnacle CRM' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  }).catch(() => {});
}

async function sendEmailSummary(newVehicles, clientMatches) {
  const toEmail = process.env.RECALL_ALERT_EMAIL;
  if (!toEmail) return;
  if (!process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY) return;

  const vehicleRows = newVehicles.map((v) =>
    `<tr><td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#d4a843;font-family:monospace;font-size:12px">${v.vin}</td>
     <td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#e8e0d0">${[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
     <td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#a89880">${v.storeName}</td></tr>`
  ).join('');

  const matchRows = clientMatches.map((m) =>
    `<tr><td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#e8e0d0">${m.clientName}</td>
     <td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#d4a843">${[m.vehicle.year, m.vehicle.make, m.vehicle.model].filter(Boolean).join(' ')}</td>
     <td style="padding:10px 12px;border-bottom:1px solid #1e1a16;color:#a89880">${m.vehicle.storeName}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0908;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:700px;margin:0 auto;padding:40px 24px">
    <p style="margin:0 0 6px;color:#d4a843;font-size:11px;letter-spacing:4px;text-transform:uppercase;text-align:center">Pinnacle CRM</p>
    <h1 style="margin:0 0 4px;color:#e8e0d0;font-size:24px;font-weight:400;text-align:center">Jessica Daily Scan</h1>
    <p style="margin:0 0 32px;color:#a89880;font-size:13px;text-align:center">${new Date().toDateString()}</p>

    <h2 style="color:#d4a843;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px">New Vehicles (${newVehicles.length})</h2>
    ${newVehicles.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:#12100e;border-radius:6px;overflow:hidden;margin-bottom:28px">
      <thead><tr style="background:#1a1614">
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">VIN</th>
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">Vehicle</th>
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">Store</th>
      </tr></thead>
      <tbody>${vehicleRows}</tbody>
    </table>` : '<p style="color:#4a4540;font-size:13px;margin-bottom:28px">No new vehicles detected today.</p>'}

    <h2 style="color:#d4a843;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:0 0 12px">Client Matches (${clientMatches.length})</h2>
    ${clientMatches.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:#12100e;border-radius:6px;overflow:hidden">
      <thead><tr style="background:#1a1614">
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">Client</th>
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">Vehicle</th>
        <th style="padding:10px 12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:2px;text-transform:uppercase">Store</th>
      </tr></thead>
      <tbody>${matchRows}</tbody>
    </table>` : '<p style="color:#4a4540;font-size:13px">No client preference matches today.</p>'}

    <p style="color:#3a3530;font-size:11px;text-align:center;margin-top:32px">Pinnacle CRM &nbsp;&middot;&nbsp; ${new Date().toUTCString()}</p>
  </div>
</body></html>`;

  await sendEmail(
    toEmail,
    `Pinnacle Daily Scan — ${newVehicles.length} new vehicles, ${clientMatches.length} client matches`,
    html
  );
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

  // Also include own-store inventory in client matching (CSV-uploaded dealership stock)
  let ownStoreVehicles = [];
  try {
    const raw = await inventoryStore.get('own-store/latest');
    if (raw) {
      const parsed = JSON.parse(raw);
      ownStoreVehicles = Array.isArray(parsed.vehicles) ? parsed.vehicles : [];
    }
  } catch {}

  const allVehiclesForMatching = [...allNewVehicles, ...ownStoreVehicles];

  let clients = [];
  try {
    const raw = await clientsStore.get('_index');
    if (raw) clients = JSON.parse(raw);
  } catch {}

  const activeClients = clients.filter((c) => c.status === 'active' || c.status === 'prospect');

  for (const vehicle of allVehiclesForMatching) {
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
