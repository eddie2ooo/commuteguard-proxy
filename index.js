const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const https = require('https');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const NJT_BASE = 'https://pcsdata.njtransit.com/api/BUSDV2';
const USERNAME = 'eddie2ooo';
const PASSWORD = '!sX#Rb@6';

let cachedToken = null;
let tokenExpiry = null;
let lastGoodData = {};

// Timeout wrapper — fails after 10 seconds
function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Retry wrapper — tries up to 2 times
async function fetchWithRetry(url, options = {}, retries = 2, ms = 10000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithTimeout(url, options, ms);
      if (resp.ok) return resp;
      throw new Error(`HTTP ${resp.status}`);
    } catch (e) {
      if (i === retries) throw e;
      console.log(`Retry ${i + 1} for ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const form = new FormData();
  form.append('username', USERNAME);
  form.append('password', PASSWORD);
  const resp = await fetchWithRetry(`${NJT_BASE}/authenticateUser`, {
    method: 'POST', body: form
  });
  const data = await resp.json();
  if (data.Authenticated === 'True') {
    cachedToken = data.UserToken;
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    console.log('Token refreshed successfully');
    return cachedToken;
  }
  throw new Error('NJT authentication failed');
}

async function njtPost(endpoint, fields) {
  const token = await getToken();
  const form = new FormData();
  form.append('token', token);
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  const resp = await fetchWithRetry(`${NJT_BASE}/${endpoint}`, {
    method: 'POST', body: form
  });
  return resp.json();
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'CommuteGuard proxy running',
    tokenCached: !!cachedToken,
    tokenExpiresIn: tokenExpiry ? Math.round((tokenExpiry - Date.now()) / 60000) + ' min' : 'none',
    lastGoodDataKeys: Object.keys(lastGoodData)
  });
});

// Get next buses at a stop — with fallback to last good data
app.get('/buses/:stop', async (req, res) => {
  const cacheKey = 'buses_' + req.params.stop;
  try {
    const start = Date.now();
    const data = await njtPost('getBusDV', {
      stop: req.params.stop,
      direction: req.query.direction || '',
      route: req.query.route || '',
      IP: ''
    });
    console.log(`getBusDV(${req.params.stop}) completed in ${Date.now() - start}ms`);
    lastGoodData[cacheKey] = { data, timestamp: Date.now() };
    res.json(data);
  } catch (e) {
    console.error(`getBusDV(${req.params.stop}) failed: ${e.message}`);
    // Return last good data if available and less than 10 minutes old
    if (lastGoodData[cacheKey] && Date.now() - lastGoodData[cacheKey].timestamp < 10 * 60 * 1000) {
      console.log(`Returning cached data for ${cacheKey}`);
      res.json({ ...lastGoodData[cacheKey].data, _cached: true, _cacheAge: Math.round((Date.now() - lastGoodData[cacheKey].timestamp) / 1000) + 's' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Get stops for a route
app.get('/stops/:route', async (req, res) => {
  try {
    const data = await njtPost('getStops', {
      route: req.params.route,
      direction: req.query.direction || '',
      namecontains: req.query.namecontains || ''
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get route trips at a location
app.get('/trips/:route/:location', async (req, res) => {
  try {
    const data = await njtPost('getRouteTrips', {
      route: req.params.route,
      location: req.params.location
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CommuteGuard proxy running on port ${PORT}`);
  setInterval(() => {
    https.get('https://commuteguard-proxy.onrender.com', (res) => {
      console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (e) => {
      console.log(`Keep-alive ping failed: ${e.message}`);
    });
  }, 10 * 60 * 1000);
});
