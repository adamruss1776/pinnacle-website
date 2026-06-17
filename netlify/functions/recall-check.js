// POST { vins: ["VIN1", "VIN2", ...] }
// Returns recall status for each VIN via NHTSA public APIs (no key required)
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { vins } = JSON.parse(event.body || '{}');
  if (!Array.isArray(vins) || vins.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'vins array required' }) };
  }

  const results = await Promise.all(vins.map(checkVin));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ results, checkedAt: new Date().toISOString() })
  };
};

async function checkVin(vin) {
  try {
    const { make, model, year } = await decodeVin(vin);
    if (!make || !model || !year) {
      return { vin, error: 'Could not decode VIN', recalls: [], hasRecall: false };
    }
    const recalls = await fetchRecalls(make, model, year);
    return { vin, make, model, year, recalls, hasRecall: recalls.length > 0 };
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
