// Netlify Scheduled Function — runs daily at 8 AM UTC
// Fetches CDK inventory, checks NHTSA recalls, emails alerts via SendGrid
// Required env vars: CDK_CLIENT_ID, CDK_CLIENT_SECRET, SENDGRID_API_KEY, RECALL_ALERT_EMAIL
// Optional env vars: CDK_TOKEN_URL, CDK_INVENTORY_URL, CDK_SUBSCRIPTION_ID, RECALL_FROM_EMAIL
exports.handler = async () => {
  const {
    CDK_CLIENT_ID, CDK_CLIENT_SECRET, CDK_TOKEN_URL, CDK_INVENTORY_URL, CDK_SUBSCRIPTION_ID,
    SENDGRID_API_KEY, RECALL_ALERT_EMAIL, RECALL_FROM_EMAIL
  } = process.env;

  if (!CDK_CLIENT_ID || !CDK_CLIENT_SECRET) {
    console.error('Daily recall scan: CDK credentials not configured');
    return { statusCode: 503 };
  }
  if (!SENDGRID_API_KEY || !RECALL_ALERT_EMAIL) {
    console.error('Daily recall scan: email not configured');
    return { statusCode: 503 };
  }

  try {
    const token = await getCDKToken(CDK_TOKEN_URL, CDK_CLIENT_ID, CDK_CLIENT_SECRET);
    const vehicles = await getCDKInventory(CDK_INVENTORY_URL, token, CDK_SUBSCRIPTION_ID);
    console.log(`Daily recall scan: fetched ${vehicles.length} vehicles from CDK`);

    const results = await Promise.all(vehicles.map(checkVin));
    const withRecalls = results.filter(r => r.hasRecall);
    console.log(`Daily recall scan: ${withRecalls.length} vehicles with active recalls`);

    if (withRecalls.length > 0) {
      await sendRecallAlert(withRecalls, SENDGRID_API_KEY, RECALL_ALERT_EMAIL, RECALL_FROM_EMAIL);
      console.log(`Daily recall scan: alert sent to ${RECALL_ALERT_EMAIL}`);
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error('Daily recall scan failed:', err.message);
    return { statusCode: 500 };
  }
};

// ---- CDK ----

async function getCDKToken(tokenUrl, clientId, clientSecret) {
  const url = tokenUrl || 'https://account.cdk.com/oauth2/v1/token';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=inventory:read'
  });
  if (!res.ok) throw new Error(`CDK auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function getCDKInventory(inventoryUrl, token, subscriptionId) {
  const url = inventoryUrl || 'https://api.cdk.com/inventory/v1/vehicles';
  const headers = { 'Authorization': `Bearer ${token}` };
  if (subscriptionId) headers['Subscription-Id'] = subscriptionId;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`CDK inventory failed: ${res.status}`);
  const data = await res.json();
  const items = data.items || data.vehicles || data.data || [];
  return items.map(v => ({
    vin: v.vin || v.VIN || v.vehicleIdentificationNumber || '',
    make: v.make || v.Make || '',
    model: v.model || v.Model || '',
    year: String(v.year || v.modelYear || v.Year || ''),
    stockNumber: v.stockNumber || v.stock || ''
  })).filter(v => v.vin);
}

// ---- NHTSA ----

async function checkVin(vehicle) {
  const { vin } = vehicle;
  try {
    let { make, model, year } = vehicle;
    if (!make || !model || !year) {
      const decoded = await decodeVin(vin);
      make = decoded.make; model = decoded.model; year = decoded.year;
    }
    const recalls = await fetchRecalls(make, model, year);
    return { vin, make, model, year, stockNumber: vehicle.stockNumber, recalls, hasRecall: recalls.length > 0 };
  } catch (err) {
    return { vin, error: err.message, recalls: [], hasRecall: false };
  }
}

async function decodeVin(vin) {
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`);
  const data = await res.json();
  const find = (label) => (data.Results || []).find(r => r.Variable === label)?.Value || '';
  return { make: find('Make'), model: find('Model'), year: find('Model Year') };
}

async function fetchRecalls(make, model, year) {
  const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.results || []).map(r => ({
    campaignNumber: r.NHTSACampaignNumber,
    component: r.Component,
    summary: r.Summary,
    consequence: r.Consequence,
    remedy: r.Remedy,
    date: r.ReportReceivedDate
  }));
}

// ---- Email ----

async function sendRecallAlert(vehicles, apiKey, toEmail, fromEmail) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail || 'alerts@pinnacle-crm.com', name: 'Pinnacle CRM' },
      subject: `⚠️ Recall Alert — ${vehicles.length} vehicle${vehicles.length > 1 ? 's' : ''} in your inventory`,
      content: [{ type: 'text/html', value: buildEmailHtml(vehicles) }]
    })
  });
  if (!res.ok) throw new Error(`SendGrid failed: ${res.status}`);
}

function buildEmailHtml(vehicles) {
  const rows = vehicles.map(v => {
    const recallItems = v.recalls.map(r =>
      `<li style="margin-bottom:10px"><strong style="color:#e8e0d0">${r.component}</strong><br><span style="color:#a89880;font-size:13px">${r.summary}</span></li>`
    ).join('');
    return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #1e1a16;color:#d4a843;font-family:monospace;font-size:13px">${v.vin}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #1e1a16;color:#e8e0d0">${v.year || ''} ${v.make || ''} ${v.model || ''}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #1e1a16">
          <span style="background:#4a1515;color:#ff6b6b;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${v.recalls.length} RECALL${v.recalls.length > 1 ? 'S' : ''}</span>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #1e1a16"><ul style="margin:0;padding-left:18px;color:#a89880">${recallItems}</ul></td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0908;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:48px 24px">
    <div style="text-align:center;margin-bottom:36px">
      <p style="margin:0 0 6px;color:#d4a843;font-size:11px;letter-spacing:4px;text-transform:uppercase">Pinnacle CRM</p>
      <h1 style="margin:0 0 8px;color:#e8e0d0;font-size:26px;font-weight:400">Recall Alert</h1>
      <p style="margin:0;color:#a89880;font-size:14px">${vehicles.length} vehicle${vehicles.length > 1 ? 's' : ''} in your inventory ${vehicles.length > 1 ? 'have' : 'has'} active NHTSA safety recalls.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#12100e;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#1a1614">
          <th style="padding:12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:3px;text-transform:uppercase">VIN</th>
          <th style="padding:12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:3px;text-transform:uppercase">Vehicle</th>
          <th style="padding:12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:3px;text-transform:uppercase">Status</th>
          <th style="padding:12px;text-align:left;color:#d4a843;font-size:10px;letter-spacing:3px;text-transform:uppercase">Recalls</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:center;margin-top:28px">
      <a href="https://www.nhtsa.gov/vehicle-safety/recalls" style="color:#d4a843;font-size:13px;text-decoration:none">View on NHTSA.gov →</a>
    </div>
    <p style="color:#3a3530;font-size:11px;text-align:center;margin-top:36px">
      Scanned ${new Date().toUTCString()} &nbsp;&middot;&nbsp; Pinnacle CRM Recall Monitor
    </p>
  </div>
</body></html>`;
}
